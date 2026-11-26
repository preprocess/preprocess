import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { CaseState, CaseView } from "../src/case-runtime.ts";
import type { CaseKey, Env, StartCase } from "../src/env.ts";
import { modelCost } from "../src/models.ts";
import { deploy } from "./deploy.ts";
// Bundled by vitest.config.ts, as the deploy command uploads it.
import sampleAgent from "./dist/sample-agent.js?raw";

const runtime = (exports as unknown as { default: unknown }).default as {
  startCase(start: StartCase): Promise<CaseView>;
  getCase(c: CaseKey): Promise<CaseView>;
  rerun(c: CaseKey & { notes?: unknown[] }): Promise<CaseState>;
};

const platform = env.PLATFORM as unknown as {
  limitSpend(organizationId: string, n: number): Promise<void>;
};

const settle = async (c: CaseKey) => {
  for (let i = 0; i < 100; i++) {
    const view = await runtime.getCase(c);
    if (view.status !== "running") return view;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("case did not settle");
};

const begin = async (organizationId: string, allowed: number) => {
  const { bundleHash } = await deploy(
    { organizationId, agentId: "agt_stock", deploymentId: "dep_1" },
    sampleAgent,
    { ERP_TOKEN: "erp-test" },
  );
  await platform.limitSpend(organizationId, allowed);
  const key = { organizationId, agentId: "agt_stock", caseId: "case_1" };
  await runtime.startCase({
    ...key,
    deploymentId: "dep_1",
    bundleHash,
    network: { allow: [], block: [] },
    input: { text: "Check stock for SKU A1 and its carrier status." },
  });
  return key;
};

const kinds = (view: CaseView, kind: string) =>
  view.capture.filter((e) => e.kind === kind);

describe("the spending limit", () => {
  it("halts a case before its first model call, and only Rerun restarts it", async () => {
    const key = await begin("org_spent", 0);
    const halted = await settle(key);
    expect(halted.status).toBe("halted");
    expect(halted.reason).toBe("spending_limit_reached");
    expect(kinds(halted, "model.request")).toHaveLength(0);
    const reported = kinds(halted, "case.event").map((e) => e.data);
    expect(reported.at(-1)).toMatchObject({
      status: "halted",
      haltReason: "spending_limit_reached",
    });

    await platform.limitSpend("org_spent", 100);
    await new Promise((r) => setTimeout(r, 200));
    expect((await runtime.getCase(key)).status).toBe("halted");

    await runtime.rerun(key);
    const done = await settle(key);
    expect(done.status).toBe("completed");
    expect(done.answer).toContain("SKU A1 checked.");
    const first = kinds(done, "model.request")[0]!.data as {
      context: { messages: unknown[] };
    };
    expect(JSON.stringify(first.context.messages)).toContain(
      "Check stock for SKU A1",
    );
  });

  it("charges each model response at Baseten's price plus 5% and reports it, so the limit can trip", async () => {
    const key = await begin("org_priced", 100);
    const done = await settle(key);
    expect(done.status).toBe("completed");
    const responses = kinds(done, "model.response").map(
      (e) => e.data.usage as { input: number; output: number },
    );
    expect(responses.length).toBeGreaterThan(0);
    // DeepSeek V4.1 Flash, the default: $0.30 in and $1.20 out per MTok, so
    // 0.315 and 1.26 micro-USD a token with the markup.
    const expected = responses.reduce(
      (sum, u) => sum + Math.round(u.input * 0.315 + u.output * 1.26),
      0,
    );
    expect(expected).toBeGreaterThan(0);
    const reported = kinds(done, "case.event")
      .map((e) => e.data)
      .filter((d) => d.type === "status");
    expect(reported.at(-1)).toMatchObject({
      status: "completed",
      costMicroUsd: expected,
    });
  });

  it("prices nothing on a self-hosted install, whose model URL is its own", () => {
    expect(modelCost({ STAGE: "dev" } as Env, "kimi-k3.1-pro")).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    const kimi = modelCost(
      { STAGE: "dev", PREPROCESS_REGION: "us" } as Env,
      "kimi-k3.1-pro",
    );
    expect(kimi.input).toBeCloseTo(2.1);
    expect(kimi.output).toBeCloseTo(10.5);
    expect(kimi.cacheRead).toBeCloseTo(0.21);
    expect(kimi.cacheWrite).toBe(0);
  });

  it("halts a running case at its next model call instead of making it", async () => {
    const key = await begin("org_capped", 1);
    const halted = await settle(key);
    expect(halted.status).toBe("halted");
    expect(kinds(halted, "model.request")).toHaveLength(1);
    expect(kinds(halted, "case.halted")).toHaveLength(1);
  });
});
