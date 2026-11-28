import type { WideEvent } from "evlog";
import { sendBatchToPostHogEvents } from "evlog/posthog";

// PostHog (spec 12 and 15): structured errors and one event per request, so
// error rate and p95 latency can be read per service. Our production stage
// binds POSTHOG_KEY; a self-hosted install binds it only when it points at its
// own PostHog. Staging and previews bind nothing, and without a key nothing
// is sent.
//
// What leaves is an allowlist: service, stage, method, route, status,
// duration, the organization id and an error's type and scrubbed message.
// Events about a case never carry text, so no case content, tool output or
// agent code's errors reach PostHog. Secrets never sit in these fields.
export type PostHogEnv = {
  POSTHOG_KEY?: string;
  POSTHOG_HOST?: string;
  POSTHOG_SAMPLE_RATE?: string;
  STAGE?: string;
};

type PostHog = { key: string; host: string; sampleRate: number; stage: string };

export const REQUEST_EVENT = "server_request";
export const EXCEPTION_EVENT = "$exception";

const DEFAULT_HOST = "https://us.i.posthog.com";

export const posthogConfig = (env: PostHogEnv): PostHog | null => {
  if (!env.POSTHOG_KEY) return null;
  const rate = Number(env.POSTHOG_SAMPLE_RATE ?? 1);
  return {
    key: env.POSTHOG_KEY,
    host: env.POSTHOG_HOST || DEFAULT_HOST,
    sampleRate: Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 1,
    stage: env.STAGE ?? "unknown",
  };
};

const text = (value: unknown) =>
  typeof value === "string" && value ? value : undefined;

// Ids, numbers and hashes in a path become :id, so a route groups requests
// without carrying case or agent ids as separate values.
export const routeOf = (path: string) =>
  path
    .split("/")
    .map((segment) =>
      /\d/.test(segment) && (segment.length >= 8 || /^\d+$/.test(segment))
        ? ":id"
        : segment,
    )
    .join("/") || "/";

// Requests nobody needs one event each for: the status page's probes,
// which hit the app, API and docs every minute, and static files. They are
// sampled at 1%, except 5xx answers, which are always sent. Each event's
// sampleRate says how to weight it.
export const LOW_VALUE_SAMPLE_RATE = 0.01;
const STATIC_FILE =
  /^\/(assets|fonts|_build)\/|\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|txt|xml|webmanifest)$/;

export const trafficOf = (path: string, userAgent: string | null) =>
  userAgent?.startsWith("PreprocessStatus/")
    ? "probe"
    : STATIC_FILE.test(path)
      ? "asset"
      : undefined;

// Free text from our own code, with anything that could be a value taken
// out: quoted strings, emails, URLs' queries, long numbers and parenthesized
// values (Postgres' "Key (email)=(...)").
export const scrub = (message: string) =>
  message
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "<value>")
    .replace(/\([^)]*\)=\([^)]*\)/g, "(<value>)")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "<email>")
    .replace(/\?\S*/g, (query) => (query.length > 1 ? "?<query>" : query))
    .replace(/\d{6,}/g, "<number>")
    .slice(0, 200);

const stackOf = (stack: unknown) =>
  text(stack)
    ?.split("\n")
    .slice(1, 11)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .map((line) => scrub(line))
    .join("\n");

const statusOf = (event: WideEvent) => {
  const status = event.status ?? (event.error as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
};

export const toPostHog = (
  service: string,
  event: WideEvent,
  sampleRate = 1,
  random = Math.random,
) => {
  const status = statusOf(event);
  const method = text(event.method);
  const path = text(event.path);
  const route = text(event.route) ?? (path ? routeOf(path) : undefined);
  const caseScoped = Boolean(text(event.caseId));
  const base = {
    timestamp: event.timestamp,
    level: event.level,
    service,
    ...(method && { method }),
    ...(route && { route }),
    ...(text(event.operation) && { operation: text(event.operation) }),
    ...(status !== undefined && { status }),
    ...(typeof event.durationMs === "number" && {
      durationMs: event.durationMs,
    }),
    ...(text(event.organizationId) && {
      organizationId: text(event.organizationId),
    }),
  } as WideEvent;
  const traffic = text(event.traffic);
  const rate =
    traffic && (status === undefined || status < 500)
      ? Math.min(sampleRate, LOW_VALUE_SAMPLE_RATE)
      : sampleRate;
  const request =
    method && status !== undefined && random() < rate
      ? { ...base, sampleRate: rate, ...(traffic && { traffic }) }
      : null;
  const failed =
    status !== undefined
      ? status >= 500
      : event.level === "error" || event.level === "fatal";
  if (!failed) return { request, exception: null };
  const error = (event.error ?? {}) as Record<string, unknown>;
  const message = text(error.message);
  const exception = {
    ...base,
    $exception_list: [
      {
        type: text(error.name) ?? text(event.operation) ?? "Error",
        value: caseScoped
          ? (text(event.operation) ?? "case error")
          : scrub(
              message ??
                [method, route, status].filter(Boolean).join(" ").trim(),
            ),
        mechanism: { handled: true, synthetic: !message },
      },
    ],
    ...(!caseScoped && stackOf(error.stack) && { stack: stackOf(error.stack) }),
  } as WideEvent;
  return { request, exception };
};

export const sendToPostHog = async (
  posthog: PostHog,
  service: string,
  event: WideEvent,
) => {
  const { request, exception } = toPostHog(service, event, posthog.sampleRate);
  const config = {
    apiKey: posthog.key,
    host: posthog.host,
    recordShape: "json" as const,
    timeout: 3000,
    retries: 0,
  };
  const stage = (e: WideEvent) => ({ ...e, stage: posthog.stage });
  await Promise.allSettled([
    request &&
      sendBatchToPostHogEvents([stage(request)], {
        ...config,
        eventName: REQUEST_EVENT,
      }),
    exception &&
      sendBatchToPostHogEvents([stage(exception)], {
        ...config,
        eventName: EXCEPTION_EVENT,
      }),
  ]);
};

// A platform metric that is neither a request nor an error, such as the
// depth of a dead-letter queue: one event per entry, where configured.
export const capturePostHog = async (
  env: PostHogEnv,
  service: string,
  eventName: string,
  entries: Record<string, string | number | null>[],
) => {
  const posthog = posthogConfig(env);
  if (!posthog || !entries.length) return;
  const timestamp = new Date().toISOString();
  await sendBatchToPostHogEvents(
    entries.map((entry) => ({
      timestamp,
      level: "info",
      service,
      environment: posthog.stage,
      stage: posthog.stage,
      ...entry,
    })),
    {
      apiKey: posthog.key,
      host: posthog.host,
      eventName,
      recordShape: "json",
      timeout: 3000,
      retries: 0,
    },
  );
};
