// OpenTelemetry export (design doc 09): the LOGS consumer forwards each
// organization's records to its OTLP/HTTP endpoint as logs, and its model
// and tool calls as spans, one trace per case. A failed export goes back on
// the queue with a delay; after the last attempt the records are dropped and
// a warning lands in the organization's own logs.

import { orgId, withOrg } from "@preprocess/db/client";
import { otelExports } from "@preprocess/db/schema/otel";
import { logId, type LogLevel, type LogRecord } from "@preprocess/logs";

import { decrypt, orgKeyVersion } from "./crypto.ts";
import type { Env } from "./env.ts";
import { sendLogs } from "./logs.ts";
import { refusedHost } from "./webhooks.ts";

// A record waiting for another export attempt. It is only exported, never
// stored or counted again.
export type OtelRetry = { otelRetry: number; record: LogRecord };

export const RETRIES = 3;
const DROPPED = "otel.export";

export const headersAad = (organizationId: string) =>
  `${organizationId}|otel_exports`;

export const exportableEndpoint = (endpoint: string) => {
  const url = new URL(endpoint);
  return url.protocol === "https:" && !refusedHost(url);
};

const hex = async (value: string, bytes: number) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ).slice(0, bytes),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// One trace per case, so every record of a case lands in the same trace.
export const traceIdOf = (caseId: string) => hex(caseId, 16);
const spanIdOf = (recordId: string) => hex(recordId, 8);

const nanos = (ms: number) => (BigInt(ms) * 1_000_000n).toString();

const SEVERITY: Record<LogLevel, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
};

type Attribute = { key: string; value: { stringValue: string } };
const attributes = (values: Record<string, string | null | undefined>) =>
  Object.entries(values).flatMap(([key, value]): Attribute[] =>
    value ? [{ key, value: { stringValue: value } }] : [],
  );

const resource = (organizationId: string) => ({
  attributes: attributes({
    "service.name": "preprocess",
    "preprocess.organization.id": organizationId,
  }),
});
const scope = { name: "preprocess" };

const recordAttributes = (r: LogRecord) =>
  attributes({
    "preprocess.kind": r.kind,
    "preprocess.source": r.source,
    "preprocess.agent.id": r.agentId,
    "preprocess.deployment.id": r.deploymentId,
    "preprocess.case.id": r.caseId,
    "preprocess.data": r.data === "{}" ? null : r.data,
    "error.message": r.error?.message,
  });

const isSpan = (r: LogRecord) =>
  r.caseId !== null &&
  r.durationMs !== null &&
  (r.kind === "model.call" || r.kind === "tool.call");

// OTLP/HTTP JSON bodies for one organization's records.
export const otlp = async (organizationId: string, records: LogRecord[]) => {
  const ids = await Promise.all(
    records.map(async (r) => ({
      traceId: r.caseId ? await traceIdOf(r.caseId) : undefined,
      spanId: isSpan(r) ? await spanIdOf(r.id) : undefined,
    })),
  );
  const logRecords = records.map((r, i) => ({
    timeUnixNano: nanos(Date.parse(r.at)),
    observedTimeUnixNano: nanos(Date.parse(r.at)),
    severityNumber: SEVERITY[r.level],
    severityText: r.level.toUpperCase(),
    body: { stringValue: r.message },
    attributes: recordAttributes(r),
    ...ids[i],
  }));
  const spans = records.flatMap((r, i) =>
    isSpan(r)
      ? [
          {
            traceId: ids[i]!.traceId!,
            spanId: ids[i]!.spanId!,
            name: r.message,
            kind: r.kind === "model.call" ? 3 : 1,
            startTimeUnixNano: nanos(Date.parse(r.at) - r.durationMs!),
            endTimeUnixNano: nanos(Date.parse(r.at)),
            attributes: recordAttributes(r),
            status:
              r.level === "error"
                ? { code: 2, message: r.error?.message ?? r.message }
                : { code: 0 },
          },
        ]
      : [],
  );
  return {
    logs: {
      resourceLogs: [
        {
          resource: resource(organizationId),
          scopeLogs: [{ scope, logRecords }],
        },
      ],
    },
    traces: spans.length
      ? {
          resourceSpans: [
            {
              resource: resource(organizationId),
              scopeSpans: [{ scope, spans }],
            },
          ],
        }
      : null,
  };
};

const target = (env: Env, organizationId: string) =>
  withOrg(env, orgId(organizationId), async (tx) => {
    const [row] = await tx.select().from(otelExports);
    if (!row?.enabled) return null;
    const key = await orgKeyVersion(env, tx, organizationId, row.keyVersion);
    const headers = JSON.parse(
      await decrypt(key, row.headersCiphertext, headersAad(organizationId)),
    ) as Record<string, string>;
    return { endpoint: row.endpoint, headers };
  });

const post = async (
  url: string,
  headers: Record<string, string>,
  body: unknown,
) => {
  const response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
};

const send = async (env: Env, organizationId: string, records: LogRecord[]) => {
  const to = await target(env, organizationId);
  if (!to) return;
  if (!exportableEndpoint(to.endpoint))
    throw new Error("the endpoint is not a public https address");
  const base = to.endpoint.replace(/\/+$/, "");
  const { logs, traces } = await otlp(organizationId, records);
  await post(base + "/v1/logs", to.headers, logs);
  if (traces) await post(base + "/v1/traces", to.headers, traces);
};

const dropped = (organizationId: string, count: number, reason: string) => {
  const at = new Date().toISOString();
  return {
    id: logId(Date.parse(at)),
    at,
    organizationId,
    agentId: null,
    deploymentId: null,
    caseId: null,
    source: "platform",
    level: "warn",
    kind: DROPPED,
    message: `OpenTelemetry export failed; ${count} records dropped`,
    durationMs: null,
    traceId: null,
    spanId: null,
    error: {
      message: reason,
      fix: "Check the endpoint and headers in the organization's OpenTelemetry export settings.",
    },
    data: "{}",
  } satisfies LogRecord;
};

// Forwards records (attempt 0 for fresh ones) to each organization's
// endpoint. It never throws: a failure is retried through the queue, so the
// batch's store writes and summaries are not repeated.
export const exportLogs = async (env: Env, batch: OtelRetry[]) => {
  const byOrg = new Map<string, OtelRetry[]>();
  for (const item of batch) {
    if (item.record.kind === DROPPED) continue;
    const id = item.record.organizationId;
    byOrg.set(id, [...(byOrg.get(id) ?? []), item]);
  }
  for (const [organizationId, items] of byOrg) {
    try {
      await send(
        env,
        organizationId,
        items.map((i) => i.record),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const again = items.filter((i) => i.otelRetry < RETRIES);
      const gone = items.length - again.length;
      try {
        for (let i = 0; i < again.length; i += 100)
          await env.LOGS.sendBatch(
            again.slice(i, i + 100).map((item) => ({
              body: { otelRetry: item.otelRetry + 1, record: item.record },
              delaySeconds: 30 * 4 ** item.otelRetry,
            })),
          );
        if (gone) await sendLogs(env, [dropped(organizationId, gone, reason)]);
      } catch (sendError) {
        console.error("otel export retry", organizationId, sendError);
      }
    }
  }
};
