import { createRequestLogger, initLogger, type WideEvent } from "evlog";
import { withEvlog } from "evlog/workers";

import {
  posthogConfig,
  routeOf,
  sendToPostHog,
  trafficOf,
  type PostHogEnv,
} from "./posthog.ts";

export {
  EXCEPTION_EVENT,
  REQUEST_EVENT,
  routeOf,
  trafficOf,
  type PostHogEnv,
} from "./posthog.ts";

// One run-log record (design doc 09): the Pipelines stream's schema, a line
// of the local NDJSON store, and what the logs API returns.
export const LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LEVELS)[number];

export type LogRecord = {
  id: string;
  at: string;
  organizationId: string;
  agentId: string | null;
  deploymentId: string | null;
  caseId: string | null;
  source: "platform" | "agent";
  level: LogLevel;
  kind: string;
  message: string;
  durationMs: number | null;
  traceId: string | null;
  spanId: string | null;
  error: {
    message: string;
    why?: string;
    fix?: string;
    status?: number;
  } | null;
  data: string;
};

// The fields a wide event sets to say whose it is. An event without an
// organization is not a tenant's log and stays out of the run log.
export type LogScope = {
  organizationId: string;
  agentId?: string;
  deploymentId?: string;
  caseId?: string;
  source?: LogRecord["source"];
  traceId?: string;
  spanId?: string;
};

const DATA_LIMIT = 16_384;

// A monotonic ULID: sortable by time, so the newest record has the largest
// id, and records made in the same millisecond (a Worker's clock stands still
// while it runs) keep the order they were made in.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let last = { time: "", random: [] as number[] };
export const logId = (at = Date.now()) => {
  let time = "";
  for (let t = at, i = 0; i < 10; i++, t = Math.floor(t / 32))
    time = CROCKFORD[t % 32] + time;
  let random: number[];
  if (time === last.time) {
    random = [...last.random];
    for (let i = 15; i >= 0 && ++random[i]! === 32; i--) random[i] = 0;
  } else {
    random = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (b) => b % 16,
    );
  }
  last = { time, random };
  return time + random.map((d) => CROCKFORD[d]).join("");
};

const text = (value: unknown) =>
  typeof value === "string" && value ? value : null;

const levelOf = (level: WideEvent["level"]): LogLevel =>
  level === "fatal" ? "error" : level === "trace" ? "debug" : level;

const errorOf = (value: unknown): LogRecord["error"] => {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  return {
    message: text(e.message) ?? "error",
    ...(text(e.why) && { why: e.why as string }),
    ...(text(e.fix) && { fix: e.fix as string }),
    ...(typeof e.status === "number" && { status: e.status }),
  };
};

export const toRecord = (event: WideEvent): LogRecord | null => {
  const organizationId = text(event.organizationId);
  if (!organizationId) return null;
  const {
    timestamp,
    level,
    service: _service,
    environment: _environment,
    duration: _duration,
    durationMs,
    agentId,
    deploymentId,
    caseId,
    source,
    traceId,
    spanId,
    operation,
    message,
    error,
    method,
    path,
    status,
    organizationId: _org,
    ...rest
  } = event;
  const kind = text(operation) ?? (text(path) ? "request" : "event");
  const at = Date.parse(timestamp);
  const data = JSON.stringify({
    ...(method !== undefined && { method, path, status }),
    ...rest,
  });
  return {
    id: logId(Number.isNaN(at) ? Date.now() : at),
    at: Number.isNaN(at) ? new Date().toISOString() : timestamp,
    organizationId,
    agentId: text(agentId),
    deploymentId: text(deploymentId),
    caseId: text(caseId),
    source: source === "agent" ? "agent" : "platform",
    level: levelOf(level),
    kind,
    message:
      text(message) ??
      (text(path) ? [method, path, status].filter(Boolean).join(" ") : kind),
    durationMs: typeof durationMs === "number" ? durationMs : null,
    traceId: text(traceId),
    spanId: text(spanId),
    error: errorOf(error),
    data:
      data.length > DATA_LIMIT
        ? JSON.stringify({ truncated: true, chars: data.length })
        : data,
  };
};

type Send = (records: LogRecord[]) => Promise<void>;
let initialized = false;
let send: Send | undefined;
let posthog: ReturnType<typeof posthogConfig> = null;

// Every platform Worker calls this before it logs, with how its records leave
// it: the API sends to the LOGS queue, the runtime through the API's Platform
// entrypoint, and the app and docs keep no run log. With POSTHOG_KEY in env,
// errors and request events also go to PostHog (posthog.ts). Events still
// print to the Worker's own console.
export const initLogs = (
  service: string,
  to: Send | undefined,
  env: PostHogEnv = {},
) => {
  send = to;
  posthog = posthogConfig(env);
  if (initialized) return;
  initialized = true;
  initLogger({
    env: { service },
    pretty: false,
    drain: async ({ event }) => {
      const record = toRecord(event);
      await Promise.all([
        record && send ? send([record]) : undefined,
        posthog ? sendToPostHog(posthog, service, event) : undefined,
      ]);
    },
  });
};

// A Worker's fetch with one wide event per request, for the Workers whose
// routes are not Hono's (the app and docs). They keep no run log, so the
// event only goes to PostHog, where configured.
export const withRequestEvents = <E extends PostHogEnv>(
  service: string,
  fetch: (
    request: Request,
    env: E,
    ctx: ExecutionContext,
  ) => Response | Promise<Response>,
) =>
  withEvlog<E, ExecutionContext>((request, env, ctx, log) => {
    initLogs(service, undefined, env);
    const { pathname } = new URL(request.url);
    log.set({
      route: routeOf(pathname),
      traffic: trafficOf(pathname, request.headers.get("user-agent")),
    });
    return fetch(request, env, ctx);
  }).fetch;

// A failure outside a request, such as a cron task or a queue batch: one
// error event, which reaches PostHog like a failed request.
export const logFailure = (
  operation: string,
  error: unknown,
  waitUntil: (promise: Promise<unknown>) => void,
) => {
  const log = createRequestLogger({ operation, waitUntil });
  log.error(error instanceof Error ? error : new Error(String(error)));
  log.emit();
};

// One wide event for a unit of work: set fields as it goes, then emit once.
export const wideEvent = (
  operation: string,
  scope: LogScope,
  waitUntil: (promise: Promise<unknown>) => void,
) => {
  const log = createRequestLogger({ operation, waitUntil });
  log.set({ ...scope });
  return log;
};
