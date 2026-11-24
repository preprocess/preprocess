import { describe, expect, it } from "vitest";

import { logId, toRecord } from "../src/index.ts";

const event = (fields: Record<string, unknown>) => ({
  timestamp: "2026-11-24T10:00:00.000Z",
  level: "info" as const,
  service: "runtime",
  environment: "test",
  ...fields,
});

describe("toRecord", () => {
  it("keeps an organization's event with its scope, timing and the rest as data", () => {
    const record = toRecord(
      event({
        organizationId: "org_a",
        agentId: "agt_1",
        caseId: "case_1",
        operation: "tool.call",
        durationMs: 12,
        tool: { name: "lookup", isError: false },
      }),
    );
    expect(record).toMatchObject({
      at: "2026-11-24T10:00:00.000Z",
      organizationId: "org_a",
      agentId: "agt_1",
      deploymentId: null,
      caseId: "case_1",
      source: "platform",
      level: "info",
      kind: "tool.call",
      message: "tool.call",
      durationMs: 12,
      error: null,
    });
    expect(JSON.parse(record!.data)).toEqual({
      tool: { name: "lookup", isError: false },
    });
  });

  it("drops events that belong to no organization", () => {
    expect(toRecord(event({ operation: "cron" }))).toBeNull();
  });

  it("names a request by its method, path and status and keeps a structured error", () => {
    const record = toRecord(
      event({
        organizationId: "org_a",
        level: "fatal",
        method: "POST",
        path: "/v1/orgs/org_a/cases",
        status: 500,
        error: { message: "boom", why: "db down", fix: "retry", stack: "…" },
      }),
    );
    expect(record).toMatchObject({
      kind: "request",
      level: "error",
      message: "POST /v1/orgs/org_a/cases 500",
      error: { message: "boom", why: "db down", fix: "retry" },
    });
  });

  it("replaces oversized data with its size", () => {
    const record = toRecord(
      event({ organizationId: "org_a", blob: "x".repeat(20_000) }),
    );
    expect(JSON.parse(record!.data)).toMatchObject({ truncated: true });
  });
});

describe("logId", () => {
  it("sorts by time", () => {
    expect(logId(1_000) < logId(2_000)).toBe(true);
    expect(logId()).toHaveLength(26);
    const same = [logId(5_000), logId(5_000), logId(5_000)];
    expect([...same].sort()).toEqual(same);
  });
});
