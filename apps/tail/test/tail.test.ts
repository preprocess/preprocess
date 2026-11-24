import { describe, expect, it } from "vitest";

import { SCOPE_HEADERS, tailRecords } from "../src/index.ts";

const item = (
  headers: Record<string, string>,
  extra: Partial<TraceItem> = {},
) =>
  ({
    scriptName: "org_a--stock--dep_1",
    outcome: "ok",
    eventTimestamp: 1_000,
    event: {
      request: { url: "https://agent/tools/lookup", method: "POST", headers },
    },
    logs: [
      { timestamp: 1_001, level: "log", message: ["looked up", { sku: "A1" }] },
      { timestamp: 1_002, level: "warn", message: ["slow"] },
    ],
    exceptions: [],
    diagnosticsChannelEvents: [],
    ...extra,
  }) as unknown as TraceItem;

const scope = {
  [SCOPE_HEADERS.organizationId]: "org_a",
  [SCOPE_HEADERS.agentId]: "agt_1",
  [SCOPE_HEADERS.deploymentId]: "dep_1",
  [SCOPE_HEADERS.caseId]: "case_1",
};

describe("tailRecords", () => {
  it("turns console output into the agent's records for its case", () => {
    const records = tailRecords([item(scope)]);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      organizationId: "org_a",
      agentId: "agt_1",
      deploymentId: "dep_1",
      caseId: "case_1",
      source: "agent",
      level: "info",
      kind: "console",
      message: 'looked up {"sku":"A1"}',
      at: new Date(1_001).toISOString(),
    });
    expect(records[1]).toMatchObject({ level: "warn", message: "slow" });
  });

  it("records exceptions and a failed outcome as errors", () => {
    const records = tailRecords([
      item(scope, {
        logs: [],
        outcome: "exceededCpu",
        exceptions: [
          { timestamp: 1_003, name: "TypeError", message: "x is undefined" },
        ],
      }),
    ]);
    expect(records.map((r) => [r.kind, r.level, r.message])).toEqual([
      ["exception", "error", "TypeError: x is undefined"],
      ["outcome", "error", "Invocation ended: exceededCpu"],
    ]);
  });

  it("drops invocations the runtime did not dispatch", () => {
    expect(tailRecords([item({})])).toEqual([]);
  });
});
