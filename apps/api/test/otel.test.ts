// OpenTelemetry export (design doc 09): only Owners and Admins set it, header
// values never come back out, and the LOGS consumer forwards an
// organization's records to its own endpoint only, retrying through the queue
// and dropping with a warning after the last attempt.

import { logId, type LogRecord } from "@preprocess/logs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { otlp } from "../src/otel.ts";
import { exportLogs, RETRIES, traceIdOf } from "../src/otel.ts";
import type { Client } from "./helpers.ts";
import {
  addMember,
  createOrganization,
  logged,
  retried,
  signUp,
  testEnv,
} from "./helpers.ts";

const environment = testEnv();
type Otlp = Awaited<ReturnType<typeof otlp>>;
const ENDPOINT = "https://otel.example.com/otlp";
const TOKEN = "otel-token-do-not-leak";

type Export = {
  endpoint: string;
  headers: string[];
  enabled: boolean;
};

let owner: Client;
let member: Client;
let other: Client;
let org: string;
let otherOrg: string;

const record = (
  organizationId: string,
  fields: Partial<LogRecord> & Pick<LogRecord, "kind" | "level" | "message">,
): LogRecord => ({
  id: logId(),
  at: new Date().toISOString(),
  organizationId,
  agentId: "agent_1",
  deploymentId: "deployment_1",
  caseId: "case_1",
  source: "platform",
  durationMs: null,
  traceId: null,
  spanId: null,
  error: null,
  data: "{}",
  ...fields,
});

const posts = () => {
  const sent: { url: string; headers: Headers; body: unknown }[] = [];
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      sent.push({
        url: request.url,
        headers: request.headers,
        body: await request.json(),
      });
      return new Response(null, { status: 200 });
    });
  return { sent, spy };
};

afterEach(() => {
  vi.restoreAllMocks();
  retried.length = 0;
});

beforeAll(async () => {
  owner = (await signUp("Olive", environment)).client;
  org = await createOrganization(owner, "Otel Acme");
  member = (await addMember(owner, org, "Mo")).client;
  other = (await signUp("Oscar", environment)).client;
  otherOrg = await createOrganization(other, "Otel Globex");
});

describe("OpenTelemetry export settings", () => {
  it("lets an Owner set it and never returns header values", async () => {
    const put = await owner.call<Export>(`/v1/orgs/${org}/settings/otel`, {
      method: "PUT",
      body: { endpoint: ENDPOINT, headers: { authorization: TOKEN } },
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      endpoint: ENDPOINT,
      headers: ["authorization"],
      enabled: true,
    });
    const get = await owner.call(`/v1/orgs/${org}/settings/otel`);
    expect(get.status).toBe(200);
    expect(JSON.stringify(get.body)).not.toContain(TOKEN);
  });

  it("audits the change without the header values", async () => {
    const audit = await owner.call<{ events: { data: unknown }[] }>(
      `/v1/orgs/${org}/audit-events?action=otel_export.created`,
    );
    expect(audit.body.events).toHaveLength(1);
    expect(audit.body.events[0]!.data).toMatchObject({
      endpoint: ENDPOINT,
      headers: ["authorization"],
    });
    expect(JSON.stringify(audit.body)).not.toContain(TOKEN);
  });

  it("refuses members who are not Owners or Admins", async () => {
    expect((await member.call(`/v1/orgs/${org}/settings/otel`)).status).toBe(
      403,
    );
    const put = await member.call(`/v1/orgs/${org}/settings/otel`, {
      method: "PUT",
      body: { endpoint: ENDPOINT },
    });
    expect(put.status).toBe(403);
  });

  it("refuses endpoints that are not public https", async () => {
    for (const endpoint of [
      "http://otel.example.com",
      "https://127.0.0.1:4318",
      "https://localhost:4318",
    ]) {
      const put = await other.call(`/v1/orgs/${otherOrg}/settings/otel`, {
        method: "PUT",
        body: { endpoint },
      });
      expect(put.status).toBe(400);
    }
  });

  it("keeps the stored headers when an update leaves them out", async () => {
    const put = await owner.call<Export>(`/v1/orgs/${org}/settings/otel`, {
      method: "PUT",
      body: { endpoint: ENDPOINT, enabled: true },
    });
    expect(put.body.headers).toEqual(["authorization"]);
    const { sent } = posts();
    await exportLogs(environment, [
      {
        otelRetry: 0,
        record: record(org, {
          kind: "case.started",
          level: "info",
          message: "x",
        }),
      },
    ]);
    expect(sent[0]!.headers.get("authorization")).toBe(TOKEN);
  });
});

describe("exporting run logs", () => {
  it("sends logs and spans with one trace per case", async () => {
    const { sent } = posts();
    const records = [
      record(org, {
        kind: "case.started",
        level: "info",
        message: "Case started",
      }),
      record(org, {
        kind: "model.call",
        level: "info",
        message: "Model call 1: toolUse",
        durationMs: 80,
      }),
      record(org, {
        kind: "tool.call",
        level: "warn",
        message: "lookup_stock failed",
        durationMs: 4,
        error: { message: "timeout" },
      }),
    ];
    await exportLogs(
      environment,
      records.map((r) => ({ otelRetry: 0, record: r })),
    );
    expect(sent.map((s) => s.url)).toEqual([
      ENDPOINT + "/v1/logs",
      ENDPOINT + "/v1/traces",
    ]);
    const traceId = await traceIdOf("case_1");
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    const logs = sent[0]!.body as Otlp["logs"];
    const logRecords = logs.resourceLogs[0]!.scopeLogs[0]!.logRecords;
    expect(logRecords.map((l) => [l.body.stringValue, l.severityText])).toEqual(
      [
        ["Case started", "INFO"],
        ["Model call 1: toolUse", "INFO"],
        ["lookup_stock failed", "WARN"],
      ],
    );
    expect(new Set(logRecords.map((l) => l.traceId))).toEqual(
      new Set([traceId]),
    );
    const traces = sent[1]!.body as NonNullable<Otlp["traces"]>;
    const spans = traces.resourceSpans[0]!.scopeSpans[0]!.spans;
    expect(spans.map((s) => [s.name, s.traceId])).toEqual([
      ["Model call 1: toolUse", traceId],
      ["lookup_stock failed", traceId],
    ]);
    expect(
      BigInt(spans[0]!.endTimeUnixNano) - BigInt(spans[0]!.startTimeUnixNano),
    ).toBe(80_000_000n);
    expect(logRecords[1]!.spanId).toBe(spans[0]!.spanId);
  });

  it("sends nothing for an organization without export", async () => {
    const { spy } = posts();
    await exportLogs(environment, [
      {
        otelRetry: 0,
        record: record(otherOrg, {
          kind: "case.started",
          level: "info",
          message: "Globex only",
        }),
      },
    ]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("retries a failed export through the queue, then drops it with a warning", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 503 }),
    );
    const failing = record(org, {
      kind: "case.started",
      level: "info",
      message: "will fail",
    });
    await exportLogs(environment, [{ otelRetry: 0, record: failing }]);
    expect(retried).toEqual([
      { body: { otelRetry: 1, record: failing }, delaySeconds: 30 },
    ]);

    const before = logged.length;
    await exportLogs(environment, [{ otelRetry: RETRIES, record: failing }]);
    expect(retried).toHaveLength(1);
    const warning = logged.slice(before);
    expect(warning).toHaveLength(1);
    expect(warning[0]).toMatchObject({
      organizationId: org,
      level: "warn",
      kind: "otel.export",
      message: "OpenTelemetry export failed; 1 records dropped",
    });
    expect(warning[0]!.error?.message).toContain("503");
  });

  it("stops exporting when switched off, and after removal", async () => {
    await owner.call(`/v1/orgs/${org}/settings/otel`, {
      method: "PUT",
      body: { endpoint: ENDPOINT, enabled: false },
    });
    const { spy } = posts();
    const item = {
      otelRetry: 0,
      record: record(org, {
        kind: "case.started",
        level: "info",
        message: "off",
      }),
    };
    await exportLogs(environment, [item]);
    expect(spy).not.toHaveBeenCalled();

    const del = await owner.call(`/v1/orgs/${org}/settings/otel`, {
      method: "DELETE",
    });
    expect(del.status).toBe(204);
    expect((await owner.call(`/v1/orgs/${org}/settings/otel`)).status).toBe(
      404,
    );
    await exportLogs(environment, [item]);
    expect(spy).not.toHaveBeenCalled();
  });
});
