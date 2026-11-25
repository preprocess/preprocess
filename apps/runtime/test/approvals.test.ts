import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { CaseState, CaseView } from "../src/case-runtime.ts";
import type { CaseKey, StartCase } from "../src/env.ts";
import { deploy } from "./deploy.ts";
// Bundled by vitest.config.ts, as the deploy command uploads it.
import approvalAgent from "./dist/approval-agent.js?raw";

const runtime = (exports as unknown as { default: unknown }).default as {
  startCase(start: StartCase): Promise<CaseView>;
  getCase(c: CaseKey): Promise<CaseView>;
  caseState(c: CaseKey): Promise<CaseState>;
  decideApproval(
    c: CaseKey & {
      id: string;
      approve: boolean;
      userId: string;
      note: string | null;
    },
  ): Promise<CaseState>;
};

const settle = async (c: CaseKey) => {
  for (let i = 0; i < 200; i++) {
    const view = await runtime.getCase(c);
    if (view.status !== "running") return runtime.caseState(c);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("case did not settle");
};

const start = async (organizationId: string) => {
  const { bundleHash } = await deploy(
    { organizationId, agentId: "agt_approve", deploymentId: "dep_1" },
    approvalAgent,
  );
  const key = { organizationId, agentId: "agt_approve", caseId: "case_1" };
  await runtime.startCase({
    ...key,
    deploymentId: "dep_1",
    bundleHash,
    network: { allow: [], block: [] },
    input: { text: "Check stock for SKU A1 and its carrier status." },
  });
  return key;
};

const ran = async (c: CaseKey) =>
  (await runtime.getCase(c)).capture.filter(
    (e) =>
      e.kind === "tool.result" &&
      (e.data as { name: string; effects?: unknown[] }).name ===
        "lookup_stock" &&
      !(e.data as { effects?: unknown[] }).effects,
  ).length;

describe("approvals", () => {
  it("hold a tool call until a person approves it, then the case's completion", async () => {
    const key = await start("org_approve");
    const waiting = await settle(key);
    expect(waiting.status).toBe("waiting");
    const call = waiting.approvals.find((a) => a.level === "tool")!;
    expect(call).toMatchObject({
      status: "pending",
      target: "lookup_stock",
      group: null,
      payload: { sku: "A1" },
    });
    expect(await ran(key)).toBe(0);

    await runtime.decideApproval({
      ...key,
      id: call.id,
      approve: true,
      userId: "usr_ana",
      note: null,
    });
    expect(await ran(key)).toBe(1);
    const done = await settle(key);
    expect(done.run).toBe(2);
    expect(done.status).toBe("waiting");
    const completion = done.approvals.find(
      (a) => a.level === "completion" && a.status === "pending",
    )!;
    expect(completion).toBeDefined();

    const completed = await runtime.decideApproval({
      ...key,
      id: completion.id,
      approve: true,
      userId: "usr_ana",
      note: null,
    });
    expect(completed.status).toBe("completed");
    expect(completed.approvals.every((a) => a.status === "approved")).toBe(
      true,
    );
  });

  it("tell the agent when a call is rejected, without running it", async () => {
    const key = await start("org_reject");
    const waiting = await settle(key);
    const call = waiting.approvals.find((a) => a.level === "tool")!;
    await runtime.decideApproval({
      ...key,
      id: call.id,
      approve: false,
      userId: "usr_ana",
      note: "Not this SKU",
    });
    const after = await settle(key);
    expect(await ran(key)).toBe(0);
    expect(after.approvals.find((a) => a.id === call.id)).toMatchObject({
      status: "rejected",
      note: "Not this SKU",
      decidedBy: "person:usr_ana",
    });
    expect(
      after.thread.some(
        (m) => m.text === "Rejected the call to lookup_stock: Not this SKU",
      ),
    ).toBe(true);
  });
});
