// Product analytics for cases (PRE-160): the runtime's reports become one
// event per change the case index records, with counts and ids only, and a
// case on a preview deployment is marked test.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { mcpServers } from "@preprocess/db/schema/mcp";
import { beforeAll, describe, expect, it } from "vitest";

import { recordCaseEvent, type CaseEvent } from "../src/cases.ts";
import { createOrganization, signUp, testEnv, tracked } from "./helpers.ts";

const environment = testEnv({ POSTHOG_KEY: "phc_test" });
const agentId = newId("agent");
const deploymentId = newId("deployment");
const serverId = newId("mcpServer");
let org: string;

// api_error samples failed requests at random, so it stays out of these.
const since = (start: number) =>
  tracked
    .slice(start)
    .filter((e) => e.event !== "$groupidentify" && e.event !== "api_error");

const newCase = async () => {
  const caseId = newId("case");
  await withOrg(environment, orgId(org), (tx) =>
    tx.insert(cases).values({
      id: caseId,
      organizationId: org,
      agentId,
      deploymentId,
      status: "running",
      source: "api",
    }),
  );
  return { organizationId: org, agentId, caseId };
};

const status = (
  status: "halted" | "completed" | "failed",
  extra: Partial<Extract<CaseEvent, { type: "status" }>> = {},
) => ({
  type: "status" as const,
  status,
  waitingOn: null,
  reason: null,
  answers: null,
  error: null,
  ...extra,
});

beforeAll(async () => {
  const { client, userId } = await signUp("Cass Analytics", environment);
  org = await createOrganization(client, "Case Analytics");
  await withOrg(environment, orgId(org), async (tx) => {
    await tx
      .insert(agents)
      .values({ id: agentId, organizationId: org, slug: "intake" });
    await tx.insert(deployments).values({
      id: deploymentId,
      organizationId: org,
      agentId,
      environment: "preview",
      status: "ready",
      bundleSha256: "00",
      sdkVersion: "0.1.0",
      manifest: {},
      source: "cli",
      createdBy: userId,
    });
    await tx.insert(mcpServers).values({
      id: serverId,
      organizationId: org,
      slug: "crm",
      url: "https://crm.example.test/mcp",
      auth: "none",
      createdBy: userId,
    });
  });
});

describe("case analytics", () => {
  it("sends one case_completed with the run's usage and one mcp_tool_called per server", async () => {
    const key = await newCase();
    const start = tracked.length;
    const completed = status("completed", {
      costMicroUsd: 250_000,
      stats: {
        model: "org:acme-invoices",
        tokensIn: 1200,
        tokensOut: 300,
        toolCalls: 4,
        modelErrors: 0,
        ocrPages: 3,
        mcp: [
          { server: "crm", calls: 3, errors: 1 },
          { server: "gone", calls: 1, errors: 0 },
        ],
      },
    });
    await recordCaseEvent(environment, { ...key, ...completed });
    await recordCaseEvent(environment, { ...key, ...completed });
    const events = since(start);
    const done = events.filter((e) => e.event === "case_completed");
    expect(done).toHaveLength(1);
    expect(done[0]!.properties).toMatchObject({
      case_id: key.caseId,
      outcome: "completed",
      error_class: "none",
      model: "org",
      tokens_in: 1200,
      tokens_out: 300,
      credits: 25,
      credits_bucket: "n10_to_100",
      tool_calls: 4,
      mcp_calls: 4,
      sandbox_seconds: 0,
      ocr_pages: 3,
      test: true,
      duration_bucket: "lt_10s",
    });
    const mcp = events.filter((e) => e.event === "mcp_tool_called");
    expect(mcp.map((e) => e.properties)).toEqual([
      expect.objectContaining({ mcp_server_id: serverId, calls: 3, errors: 1 }),
    ]);
    expect(JSON.stringify(events)).not.toContain("acme-invoices");
  });

  it("classes a timeout and sends a halt once, apart from completion", async () => {
    const failing = await newCase();
    const halting = await newCase();
    const start = tracked.length;
    await recordCaseEvent(environment, {
      ...failing,
      ...status("failed", {
        error: {
          code: "timeout",
          message: "The run passed its 60 second limit",
        },
      }),
    });
    const halted = status("halted", { haltReason: "credit_exhausted" });
    await recordCaseEvent(environment, { ...halting, ...halted });
    await recordCaseEvent(environment, { ...halting, ...halted });
    const events = since(start);
    expect(
      events
        .filter((e) => e.event === "case_completed")
        .map((e) => e.properties),
    ).toEqual([
      expect.objectContaining({
        case_id: failing.caseId,
        outcome: "failed",
        error_class: "timeout",
        model: "unknown",
      }),
    ]);
    expect(
      events.filter((e) => e.event === "case_halted").map((e) => e.properties),
    ).toEqual([
      expect.objectContaining({
        case_id: halting.caseId,
        cause: "credit_exhausted",
        test: true,
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("second limit");
  });

  it("sends approval_requested once per approval, and nothing for an unknown case", async () => {
    const key = await newCase();
    const start = tracked.length;
    const approval = {
      id: `apr_${crypto.randomUUID().replaceAll("-", "")}`,
      level: "tool" as const,
      target: "pay_invoice",
      group: null,
      payload: { amount: 4411 },
      reason: "Pay ACME",
      status: "pending" as const,
      run: 1,
      requestedAt: Date.now(),
      decidedBy: null,
      decidedAt: null,
      note: null,
    };
    await recordCaseEvent(environment, { ...key, type: "approval", approval });
    await recordCaseEvent(environment, { ...key, type: "approval", approval });
    await recordCaseEvent(environment, {
      ...key,
      caseId: newId("case"),
      ...status("completed"),
    });
    const events = since(start);
    expect(events.map((e) => [e.event, e.properties.level])).toEqual([
      ["approval_requested", "tool"],
    ]);
    expect(events[0]!.properties).toMatchObject({ group: false, test: true });
    expect(JSON.stringify(events)).not.toContain("ACME");
  });
});
