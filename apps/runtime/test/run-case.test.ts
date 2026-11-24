import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { CaseView } from "../src/case-runtime.ts";
import type { RunCapture } from "../src/capture.ts";
import type { StartCase } from "../src/env.ts";
import { deploy } from "./deploy.ts";
// Bundled by vitest.config.ts, as the deploy command uploads it.
import sampleAgent from "./dist/sample-agent.js?raw";

const SECRET = "erp-live-7c1f9a";

let bundleHash = "";
const deployStock = async (
  organizationId: string,
  secrets: Record<string, string>,
) => {
  ({ bundleHash } = await deploy(
    { organizationId, agentId: "agt_stock", deploymentId: "dep_1" },
    sampleAgent,
    secrets,
  ));
};

const runtime = (exports as unknown as { default: unknown }).default as {
  startCase(start: StartCase): Promise<CaseView>;
  getCase(c: {
    organizationId: string;
    agentId: string;
    caseId: string;
  }): Promise<CaseView>;
};

const settle = async (c: {
  organizationId: string;
  agentId: string;
  caseId: string;
}) => {
  for (let i = 0; i < 100; i++) {
    const view = await runtime.getCase(c);
    if (view.status !== "running") return view;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("case did not settle");
};

const start = (
  organizationId: string,
  caseId: string,
  block: string[] = [],
): StartCase => ({
  organizationId,
  agentId: "agt_stock",
  deploymentId: "dep_1",
  bundleHash,
  network: { allow: [], block },
  caseId,
  input: { text: "Check stock for SKU A1 and its carrier status." },
});

describe("one case end to end", () => {
  it("runs the agent's tools through dispatch and seals a run capture", async () => {
    await deployStock("org_a", { ERP_TOKEN: SECRET });
    const begun = await runtime.startCase(
      start("org_a", "case_1", ["example.com"]),
    );
    expect(begun.status).toBe("running");
    const done = await settle({
      organizationId: "org_a",
      agentId: "agt_stock",
      caseId: "case_1",
    });
    expect(done.reason).toBeUndefined();
    expect(done.status).toBe("completed");
    expect(done.answer).toContain("SKU A1 checked.");

    const results = done.capture.filter((e) => e.kind === "tool.result");
    expect(results.map((e) => e.data.name)).toEqual([
      "lookup_stock",
      "carrier_status",
    ]);
    // The secret reached the deployed code (it measured it) but nothing it returned.
    expect(results[0]!.data.output).toMatchObject({
      authorization: "Bearer [redacted:ERP_TOKEN]",
      tokenLength: SECRET.length,
    });
    // The organization's network rules applied to the agent's fetch.
    expect(results[1]!.data.output).toMatchObject({ status: 403 });

    const stored = await env.RUNS.get(done.captureKey);
    expect(done.captureKey).toBe(
      "org_a/agents/agt_stock/cases/case_1/run.v1.json",
    );
    const capture = await stored!.json<RunCapture>();
    expect(capture).toMatchObject({
      format: "preprocess.run",
      version: 1,
      organizationId: "org_a",
      deploymentId: "dep_1",
      sdkVersion: "0.1.0",
      model: "inkling-2-small",
      status: "completed",
    });
    expect(capture.usage.input).toBeGreaterThan(0);
    expect(capture.events.map((e) => e.kind)).toContain("model.request");
    // Every model call carries the agent's reasoning level (the SDK default).
    expect(
      capture.events
        .filter((e) => e.kind === "model.request")
        .map((e) => e.data.reasoning),
    ).toSatisfy((levels: unknown[]) => levels.every((l) => l === "medium"));
    expect(JSON.stringify(capture)).not.toContain(SECRET);
  });

  it("keeps each organization's network rules and secrets to itself", async () => {
    await deployStock("org_b", {});
    await runtime.startCase(start("org_b", "case_1"));
    const done = await settle({
      organizationId: "org_b",
      agentId: "agt_stock",
      caseId: "case_1",
    });
    const results = done.capture.filter((e) => e.kind === "tool.result");
    expect(results[0]!.data.output).toMatchObject({
      authorization: "Bearer undefined",
      tokenLength: 0,
    });
    expect(results[1]!.data.output).toMatchObject({ status: 200 });
  });

  it("refuses to serve a case under another organization's object", async () => {
    const stub = env.CASE_RUNTIME.getByName(
      "org_a:agt_stock:case_9",
    ) as unknown as {
      start(s: StartCase): Promise<CaseView>;
    };
    const error: unknown = await stub.start(start("org_b", "case_9")).then(
      () => null,
      (e: unknown) => e,
    );
    expect(String(error)).toMatch(/cannot serve/);
  });
});
