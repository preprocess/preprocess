// Retention (spec 16a): the API deletes a closed case's run capture, or all of
// its state, through these RPC methods.

import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { CaseView } from "../src/case-runtime.ts";
import type { CaseKey, StartCase } from "../src/env.ts";
import { deploy } from "./deploy.ts";
// Bundled by vitest.config.ts, as the deploy command uploads it.
import sampleAgent from "./dist/sample-agent.js?raw";

const runtime = (exports as unknown as { default: unknown }).default as {
  startCase(start: StartCase): Promise<CaseView>;
  getCase(c: CaseKey): Promise<CaseView>;
  deleteCapture(c: CaseKey): Promise<void>;
  deleteCase(c: CaseKey): Promise<void>;
};

const run = async (organizationId: string, caseId: string) => {
  const { bundleHash } = await deploy(
    { organizationId, agentId: "agt_keep", deploymentId: "dep_1" },
    sampleAgent,
    { ERP_TOKEN: "erp-test" },
  );
  const key = { organizationId, agentId: "agt_keep", caseId };
  await runtime.startCase({
    ...key,
    deploymentId: "dep_1",
    bundleHash,
    network: { allow: [], block: [] },
    input: { text: "Check stock for SKU A1 and its carrier status." },
  });
  for (let i = 0; i < 100; i++) {
    const view = await runtime.getCase(key);
    if (view.status !== "running") return { key, view };
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("case did not settle");
};

describe("retention", () => {
  it("deletes a closed case's run capture from RUNS and its object", async () => {
    const { key, view } = await run("org_keep", "case_capture");
    expect(view.status).toBe("completed");
    expect(await env.RUNS.head(view.captureKey)).not.toBeNull();
    await runtime.deleteCapture(key);
    await runtime.deleteCapture(key);
    expect(await env.RUNS.head(view.captureKey)).toBeNull();
    const after = await runtime.getCase(key);
    expect(after.capture).toEqual([]);
    expect(after.status).toBe("completed");
  });

  it("deletes a case's whole object and capture, and only that case's", async () => {
    const { key, view } = await run("org_keep", "case_whole");
    const other = await run("org_other", "case_whole");
    await runtime.deleteCase(key);
    await runtime.deleteCase(key);
    expect(await env.RUNS.head(view.captureKey)).toBeNull();
    const object = env.CASE_RUNTIME.getByName(
      `${key.organizationId}:${key.agentId}:${key.caseId}`,
    );
    await runInDurableObject(object, (_, state) => {
      expect(state.storage.sql.databaseSize).toBeLessThan(8192);
      expect(
        state.storage.sql
          .exec<{
            name: string;
          }>("SELECT name FROM sqlite_master WHERE type = 'table'")
          .toArray()
          .filter((t) => !t.name.startsWith("_cf")),
      ).toEqual([]);
    });
    expect(await env.RUNS.head(other.view.captureKey)).not.toBeNull();
    expect((await runtime.getCase(other.key)).capture.length).toBeGreaterThan(
      0,
    );
  });
});
