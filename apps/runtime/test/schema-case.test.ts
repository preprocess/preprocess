import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { CaseState, CaseView } from "../src/case-runtime.ts";
import type { CaseKey, StartCase } from "../src/env.ts";
// Bundled by vitest.config.ts, as the deploy command uploads it.
import invoiceAgent from "./dist/invoice-agent.js?raw";

type Runtime = {
  startCase(start: StartCase): Promise<CaseView>;
  caseState(c: CaseKey): Promise<CaseState>;
  editAnswer(
    c: CaseKey & {
      path: string;
      value: unknown;
      version: number;
      userId: string;
    },
  ): Promise<{
    result: { result: string; stale?: string[] };
  }>;
  confirmAnswer(
    c: CaseKey & { path: string; version: number; userId: string },
  ): Promise<unknown>;
  acceptSuggestion(
    c: CaseKey & { path: string; version: number; userId: string },
  ): Promise<unknown>;
  postMessage(
    c: CaseKey & { userId: string; text: string },
  ): Promise<{ id: string; mentioned: string[] }>;
  rerun(c: CaseKey & { notes?: unknown[] }): Promise<CaseState>;
  getCase(c: CaseKey): Promise<CaseView>;
};

const runtime = (exports as unknown as { default: Runtime }).default;

const key = (caseId: string): CaseKey => ({
  organizationId: "org_inv",
  agentId: "agt_invoices",
  caseId,
});

const settle = async (c: CaseKey) => {
  for (let i = 0; i < 200; i++) {
    const state = await runtime.caseState(c);
    if (state.status !== "running") return state;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("case did not settle");
};

const field = (state: CaseState, path: string) => {
  const f = state.fields.find((x) => x.path === path);
  if (!f) throw new Error(`no field ${path}`);
  return f;
};

describe("a case with an output schema", () => {
  it("is filled by the agent, edited by a person, and rerun with a suggestion beside the edit", async () => {
    await env.NAMESPACE_ADMIN.putScript("org_inv--invoices--dep_1", {
      mainModule: "agent.js",
      modules: { "agent.js": invoiceAgent },
      bindings: [],
      tags: ["org:org_inv"],
    });
    const c = key("case_inv_1");
    await runtime.startCase({
      ...c,
      deploymentId: "dep_1",
      script: "org_inv--invoices--dep_1",
      network: { allow: [], block: [] },
      input: { text: "Invoice 1042 from Acme Corporation, total 1,285.00 USD" },
      groups: [
        {
          id: "grp_ap",
          slug: "accounts-payable",
          name: "Accounts payable",
          description: null,
          access: "operator",
        },
      ],
    });

    const first = await settle(c);
    expect(first.status).toBe("waiting");
    expect(first.waitingOn).toEqual({
      group: "accounts-payable",
      reason: "Vendor needs a check",
    });
    expect(field(first, "vendor").answer).toMatchObject({
      value: "acme",
      status: "agent",
      setBy: "agent",
    });
    expect(field(first, "approverNote").visible).toBe(true);
    expect(first.answers).toEqual({
      vendor: "acme",
      amount: 1285,
      currency: "USD",
    });
    expect(first.checks).toEqual([{ name: "amountPositive", ok: true }]);
    expect(first.thread.map((m) => m.kind)).toEqual(["input", "tag", "agent"]);
    expect(first.thread[1]).toMatchObject({ group: "accounts-payable" });

    const view = await runtime.getCase(c);
    const decided = view.capture.find((e) => e.kind === "decide");
    expect(decided?.data).toMatchObject({
      picks: [{ id: "acme", probability: 0.93 }],
    });
    const reported = view.capture
      .filter((e) => e.kind === "case.event")
      .map((e) => (e.data.type === "status" ? e.data.status : e.data.type));
    expect(reported).toEqual(["running", "mention", "waiting"]);

    // A person corrects the vendor: currency read the vendor, so it is stale.
    const vendor = field(first, "vendor").answer!;
    const edited = await runtime.editAnswer({
      ...c,
      path: "vendor",
      value: "globex",
      version: vendor.version,
      userId: "usr_ana",
    });
    expect(edited.result).toMatchObject({ result: "ok", stale: ["currency"] });
    const afterEdit = await runtime.caseState(c);
    expect(field(afterEdit, "vendor").answer).toMatchObject({
      value: "globex",
      status: "confirmed",
      setBy: "person:usr_ana",
    });
    expect(field(afterEdit, "currency").answer).toMatchObject({
      status: "stale",
      staleBecause: [{ path: "vendor", from: "acme", to: "globex" }],
    });

    // Two people (or a person and the agent) never overwrite each other.
    const conflict = await runtime.editAnswer({
      ...c,
      path: "vendor",
      value: "initech",
      version: vendor.version,
      userId: "usr_bo",
    });
    expect(conflict.result).toEqual({
      result: "conflict",
      path: "vendor",
      version: vendor.version + 1,
    });

    const posted = await runtime.postMessage({
      ...c,
      userId: "usr_ana",
      text: "It is Globex, see the letterhead. @accounts-payable fyi",
    });
    expect(posted.mentioned).toEqual(["accounts-payable"]);

    await runtime.rerun({
      ...c,
      notes: [
        {
          kind: "field.edited",
          path: "vendor",
          before: "acme",
          after: "globex",
        },
      ],
    });
    const second = await settle(c);
    expect(second.status).toBe("completed");
    expect(second.run).toBe(2);
    // The rerun never refills a person's answer; its value sits beside it.
    expect(field(second, "vendor").answer).toMatchObject({
      value: "globex",
      status: "confirmed",
      suggestedValue: "acme",
    });
    // The agent's own stale answer is refilled.
    expect(field(second, "currency").answer).toMatchObject({
      value: "EUR",
      status: "agent",
    });
    expect(second.answers).toMatchObject({ vendor: "globex", currency: "EUR" });

    // Accepting the suggestion writes it as the person's confirmed answer.
    const held = field(second, "vendor").answer!;
    await runtime.acceptSuggestion({
      ...c,
      path: "vendor",
      version: held.version,
      userId: "usr_ana",
    });
    const accepted = await runtime.caseState(c);
    expect(field(accepted, "vendor").answer).toMatchObject({
      value: "acme",
      status: "confirmed",
      setBy: "person:usr_ana",
    });
    expect(field(accepted, "vendor").answer?.suggestedValue).toBeUndefined();
  });
});
