import { describe, expect, it } from "vitest";
import { z } from "zod";

import { agent, schema, tool } from "../src/index.ts";
import type { EvaluateResponse, ToolResult } from "../src/protocol.ts";

const invoices = agent({
  instructions: "Pay invoices.",
  groups: ["finance", "legal"],
  schema: schema.group({
    vendor: schema.text(),
    amount: schema.number({
      approval: {
        group: "finance",
        when: (a) => Number(a.get("amount")) > 1000,
      },
    }),
    contract: schema.group(
      { party: schema.text(), term: schema.number() },
      { approval: { group: "legal" } },
    ),
    lines: schema.list(
      schema.group({
        sku: schema.text(),
        note: schema.text({ approval: true }),
      }),
    ),
    risky: schema.text({
      approval: {
        when: () => {
          throw new Error("rule broke");
        },
      },
    }),
  }),
  approval: { group: "finance", when: (a) => a.get("vendor") === "Globex" },
  tools: {
    pay: tool({
      description: "Pay an invoice",
      input: z.object({ amount: z.number() }),
      sideEffects: true,
      approval: { group: "finance", when: ({ amount }) => amount > 500 },
      run: ({ amount }) => ({ paid: amount }),
    }),
    notify: tool({
      description: "Tell the vendor",
      input: z.object({}),
      approval: true,
      run: () => "sent",
    }),
    lookup: tool({
      description: "Look up a vendor",
      input: z.object({}),
      run: () => "found",
    }),
  },
});

const call = async (name: string, input: unknown, approved?: true) =>
  (
    await invoices.fetch(
      new Request(`https://agent/tools/${name}`, {
        method: "POST",
        body: JSON.stringify({
          input,
          case: { id: "case_1" },
          callId: "c1",
          ...(approved && { approved }),
        }),
      }),
      {},
    )
  ).json<ToolResult>();

const evaluate = async (answers: Record<string, unknown>) =>
  (
    await invoices.fetch(
      new Request("https://agent/schema/evaluate", {
        method: "POST",
        body: JSON.stringify({
          caseId: "case_1",
          answers,
          fetched: {},
          targets: "all",
        }),
      }),
      {},
    )
  ).json<EvaluateResponse>();

describe("approvals", () => {
  it("lists every approval in the manifest with the groups that approve", () => {
    expect(invoices.manifest.approvals).toEqual({
      groups: ["finance", "legal"],
      agent: { group: "finance", conditional: true },
      fields: [
        { path: "amount", group: "finance", conditional: true },
        { path: "contract", group: "legal", conditional: false },
        { path: "lines[].note", group: null, conditional: false },
        { path: "risky", group: null, conditional: true },
      ],
      tools: [
        { name: "pay", group: "finance", conditional: true },
        { name: "notify", group: null, conditional: false },
      ],
    });
  });

  it("leaves the manifest without approvals when the code declares none", () => {
    const plain = agent({ instructions: "x", tools: {} });
    expect(plain.manifest.approvals).toBeUndefined();
  });

  it("holds a tool call that needs approval, and runs it once approved", async () => {
    expect(await call("pay", { amount: 900 })).toEqual({
      output: null,
      isError: false,
      effects: [
        {
          type: "approval",
          group: "finance",
          reason: "pay needs approval before it runs",
        },
      ],
    });
    expect(await call("pay", { amount: 900 }, true)).toEqual({
      output: { paid: 900 },
      isError: false,
    });
    expect(await call("pay", { amount: 20 })).toEqual({
      output: { paid: 20 },
      isError: false,
    });
    expect((await call("notify", {})).effects).toEqual([
      {
        type: "approval",
        group: null,
        reason: "notify needs approval before it runs",
      },
    ]);
    expect(await call("lookup", {})).toEqual({
      output: "found",
      isError: false,
    });
  });

  it("marks the fields whose approval applies, a group's covering its subtree", async () => {
    const small = await evaluate({
      vendor: "Acme",
      amount: 200,
      "lines.length": 1,
    });
    expect(small.fields.amount?.approval).toBeUndefined();
    expect(small.fields.vendor?.approval).toBeUndefined();
    expect(small.fields["contract.party"]?.approval).toEqual({
      group: "legal",
    });
    expect(small.fields["contract.term"]?.approval).toEqual({ group: "legal" });
    expect(small.approval).toBeUndefined();
    const large = await evaluate({ vendor: "Globex", amount: 5000 });
    expect(large.fields.amount?.approval).toEqual({ group: "finance" });
    expect(large.approval).toEqual({ group: "finance" });
  });

  it("fails closed when a when() throws", async () => {
    const response = await evaluate({});
    expect(response.fields.risky).toMatchObject({
      approval: { group: null },
      error: "rule broke",
    });
  });

  it("refuses approvals naming undeclared groups, or a conditional one without a schema", () => {
    expect(() =>
      agent({
        instructions: "x",
        groups: ["finance"],
        tools: {
          pay: tool({
            description: "Pay",
            input: z.object({}),
            approval: { group: "treasury" },
            run: () => null,
          }),
        },
      }),
    ).toThrow(
      "approval group treasury is not declared in this agent's groups list",
    );
    expect(() =>
      agent({
        instructions: "x",
        tools: {},
        approval: { when: () => true },
      }),
    ).toThrow("approval.when needs a schema");
    expect(() =>
      agent({
        instructions: "x",
        tools: {},
        approval: { group: 3 } as never,
      }),
    ).toThrow("approval must be true or { group?: string, when?: function }");
  });
});
