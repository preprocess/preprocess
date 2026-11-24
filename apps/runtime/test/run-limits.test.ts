import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { CaseView } from "../src/case-runtime.ts";
import type { CaseKey, Settings, StartCase } from "../src/env.ts";
import { deploy } from "./deploy.ts";
// Bundled by vitest.config.ts, as the deploy command uploads it.
import failingAgent from "./dist/failing-agent.js?raw";

const runtime = (exports as unknown as { default: unknown }).default as {
  startCase(start: StartCase): Promise<CaseView>;
  getCase(c: CaseKey): Promise<CaseView>;
};

const settle = async (c: CaseKey) => {
  for (let i = 0; i < 200; i++) {
    const view = await runtime.getCase(c);
    if (view.status !== "running") return view;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("case did not settle");
};

const settings = (overrides: Partial<Settings>): Settings => ({
  model: "inkling-2-small",
  reasoning: "low",
  ocr: false,
  timeoutSeconds: null,
  toolRetries: null,
  sandboxImage: null,
  evals: { onPush: false },
  schedules: {},
  ...overrides,
});

const run = async (
  organizationId: string,
  caseId: string,
  overrides: Partial<Settings>,
) => {
  const { bundleHash } = await deploy(
    { organizationId, agentId: "agt_failing", deploymentId: "dep_1" },
    failingAgent,
  );
  const key = { organizationId, agentId: "agt_failing", caseId };
  await runtime.startCase({
    ...key,
    deploymentId: "dep_1",
    bundleHash,
    network: { allow: [], block: [] },
    input: { text: "Check stock for SKU A1 and its carrier status." },
    settings: settings(overrides),
  });
  return settle(key);
};

const attempts = (view: CaseView, name: string) =>
  view.capture.filter(
    (e) =>
      e.kind === "tool.result" && (e.data as { name: string }).name === name,
  ).length;

describe("tool retries", () => {
  it("retry a failing tool up to toolRetries times, never one with side effects", async () => {
    const view = await run("org_retries", "case_1", { toolRetries: 2 });
    expect(attempts(view, "lookup_stock")).toBe(3);
    expect(attempts(view, "carrier_status")).toBe(1);
  });

  it("run each call once without toolRetries", async () => {
    const view = await run("org_no_retries", "case_1", {});
    expect(attempts(view, "lookup_stock")).toBe(1);
  });
});

describe("the run timeout", () => {
  it("fails the case with reason timeout once the run passes timeoutSeconds", async () => {
    const view = await run("org_timeout", "case_slow", { timeoutSeconds: 1 });
    expect(view.status).toBe("failed");
    expect(view.reason).toBe("timeout");
    expect(
      view.capture.some(
        (e) =>
          e.kind === "case.failed" &&
          (e.data as { reason: string }).reason === "timeout",
      ),
    ).toBe(true);
  });
});
