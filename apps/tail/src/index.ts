// The Tail Worker on every agent script (design doc 09): the customer
// Worker's console output and uncaught exceptions become run-log records with
// source "agent". The SDK has already masked bound secret values in console
// output. Which organization, agent, deployment and case an invocation served
// comes from the headers the runtime sets on every dispatch, which the agent's
// code cannot change.

import { logId, type LogLevel, type LogRecord } from "@preprocess/logs";

type Env = {
  PLATFORM: { logs(records: LogRecord[]): Promise<void> };
};

export const SCOPE_HEADERS = {
  organizationId: "x-preprocess-org",
  agentId: "x-preprocess-agent",
  deploymentId: "x-preprocess-deployment",
  caseId: "x-preprocess-case",
} as const;

const MESSAGE_LIMIT = 4000;

const LEVEL: Record<string, LogLevel> = {
  debug: "debug",
  info: "info",
  log: "info",
  warn: "warn",
  error: "error",
};

const text = (part: unknown) =>
  typeof part === "string" ? part : JSON.stringify(part);

const clip = (value: string) =>
  value.length > MESSAGE_LIMIT ? value.slice(0, MESSAGE_LIMIT) + "…" : value;

export const tailRecords = (events: TraceItem[]): LogRecord[] =>
  events.flatMap((item) => {
    const event = item.event as TraceItemFetchEventInfo | null;
    const headers = event?.request?.headers ?? {};
    const scope = Object.fromEntries(
      Object.entries(SCOPE_HEADERS).map(([key, header]) => [
        key,
        headers[header] ?? null,
      ]),
    ) as Record<keyof typeof SCOPE_HEADERS, string | null>;
    const organizationId = scope.organizationId;
    if (!organizationId) return [];
    const base = (at: number) => ({
      id: logId(at),
      at: new Date(at).toISOString(),
      organizationId,
      agentId: scope.agentId,
      deploymentId: scope.deploymentId,
      caseId: scope.caseId,
      source: "agent" as const,
      durationMs: null,
      traceId: null,
      spanId: null,
    });
    const path = event?.request?.url
      ? new URL(event.request.url).pathname
      : null;
    return [
      ...item.logs.map((log): LogRecord => ({
        ...base(log.timestamp),
        level: LEVEL[log.level] ?? "info",
        kind: "console",
        message: clip(
          (Array.isArray(log.message) ? log.message : [log.message])
            .map(text)
            .join(" "),
        ),
        error: null,
        data: JSON.stringify({ path }),
      })),
      ...item.exceptions.map((exception): LogRecord => ({
        ...base(exception.timestamp),
        level: "error",
        kind: "exception",
        message: clip(exception.name + ": " + exception.message),
        error: { message: clip(exception.message) },
        data: JSON.stringify({ path, name: exception.name }),
      })),
      ...(item.outcome !== "ok" && item.outcome !== "unknown"
        ? [
            {
              ...base(item.eventTimestamp ?? Date.now()),
              level: "error" as const,
              kind: "outcome",
              message: "Invocation ended: " + item.outcome,
              error: { message: item.outcome },
              data: JSON.stringify({ path }),
            },
          ]
        : []),
    ];
  });

export default {
  async tail(events, env) {
    const records = tailRecords(events);
    if (records.length) await env.PLATFORM.logs(records);
  },
} satisfies ExportedHandler<Env>;
