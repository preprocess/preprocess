import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  agent,
  schema as s,
  tool,
  type FunctionContext,
} from "../src/index.ts";
import type {
  EvaluateRequest,
  EvaluateResponse,
  Manifest,
  OptionsRequest,
  OptionsResponse,
  ToolResult,
} from "../src/protocol.ts";

const env = { ERP_TOKEN: "erp-secret-123" };

const VENDORS = Array.from({ length: 45 }, (_, i) => ({
  id: `v${i}`,
  label: i === 7 ? "Acme Supplies" : `Vendor ${i}`,
}));

const search = vi.fn(
  (query: string, { cursor, limit }: { cursor?: string; limit: number }) => {
    const matches = VENDORS.filter((v) =>
      v.label.toLowerCase().includes(query.toLowerCase()),
    );
    const offset = Number(cursor ?? 0);
    return Promise.resolve({
      items: matches.slice(offset, offset + limit),
      ...(offset + limit < matches.length && {
        cursor: String(offset + limit),
      }),
      total: matches.length,
    });
  },
);
const fetchVendor = vi.fn(
  (inputs: { vendor: unknown }, { env: e }: FunctionContext) =>
    Promise.resolve({
      id: inputs.vendor,
      currency: inputs.vendor === "v1" ? "EUR" : "USD",
      token: e.ERP_TOKEN,
    }),
);

const output = s.group(
  {
    vendor: s.select({
      description: "Vendor that issued the invoice",
      options: s.source({
        search,
        get: (ids) => VENDORS.filter((v) => ids.includes(v.id)),
      }),
      review: "required",
    }),
    vendorRecord: s.fetched({
      inputs: (a) => ({ vendor: a.get("vendor") }),
      fetch: fetchVendor,
      transform: (data) => ({ currency: data.currency }),
      visible: (a) => a.get("vendor") !== null,
    }),
    currency: s.select({
      options: (a) => {
        const record = a.fetched("vendorRecord") as { currency: string } | null;
        return record ? [record.currency] : ["USD", "EUR", "GBP"];
      },
    }),
    total: s.number(),
    lines: s.list(
      s.group({
        sku: s.text(),
        glAccount: s.select({
          visible: (a) => a.get("vendor") !== null,
          options: (a) => [`gl-${String(a.sibling("sku"))}`],
          invalidates: ["total"],
        }),
        amount: s.number(),
      }),
      { review: "none" },
    ),
    approverNote: s.text({
      visible: (a) => a.sum("lines[*].amount") > 10_000,
      review: "required",
    }),
    leak: s.text({
      review: () => {
        throw new Error(`boom ${env.ERP_TOKEN}`);
      },
    }),
  },
  {
    review: "none",
    checks: {
      totalsMatch: (a) =>
        a.sum("lines[*].amount") === a.get("total") || {
          field: "total",
          message: "Lines do not add up",
        },
      noteGiven: (a) => a.get("approverNote") !== null || "Note missing",
    },
  },
);

const invoices = agent({
  instructions: "Code invoices.",
  secrets: ["ERP_TOKEN"],
  groups: ["accounts-payable", "legal"],
  schedules: [
    { name: "nightly-reconcile", cron: "0 2 * * *", text: "Reconcile" },
    {
      name: "weekly",
      cron: "0 9 * * MON",
      timezone: "America/New_York",
      text: "Weekly",
      previews: true,
    },
  ],
  ocr: true,
  schema: output,
  tools: {
    escalate: tool({
      description: "Escalate",
      input: z.object({ group: z.string() }),
      run: ({ group }, ctx) => {
        ctx.waitOn(group, { reason: "Vendor not found" });
        ctx.tag("legal", `Check terms ${ctx.env.ERP_TOKEN}`);
        return "ok";
      },
    }),
    plain: tool({
      description: "No effects",
      input: z.object({}),
      run: () => "ok",
    }),
  },
});

const post = async <T>(path: string, body: unknown) => {
  const response = await invoices.fetch(
    new Request(`https://agent${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: response.status, body: await response.json<T>() };
};

const evaluate = async (request: Partial<EvaluateRequest>) =>
  (
    await post<EvaluateResponse>("/schema/evaluate", {
      caseId: "case_1",
      answers: {},
      fetched: {},
      targets: "all",
      ...request,
    })
  ).body;

const options = (request: Partial<OptionsRequest>) =>
  post<OptionsResponse>("/schema/options", {
    caseId: "case_1",
    answers: {},
    limit: 20,
    ...request,
  });

describe("schema manifest", () => {
  it("serialises the static tree, groups, schedules and ocr", () => {
    const manifest = invoices.manifest;
    expect(manifest.schema?.checks).toEqual(["totalsMatch", "noteGiven"]);
    expect(manifest.schema?.root.fields?.vendor).toEqual({
      kind: "select",
      description: "Vendor that issued the invoice",
      review: "required",
      source: { search: true, get: true, page: false },
      dynamic: { visible: false, options: false, review: false, fetch: false },
    });
    expect(manifest.schema?.root.fields?.vendorRecord?.dynamic).toEqual({
      visible: true,
      options: false,
      review: false,
      fetch: true,
    });
    expect(manifest.schema?.root.fields?.currency).toMatchObject({
      review: "none",
      dynamic: { options: true },
    });
    expect(
      manifest.schema?.root.fields?.lines?.item?.fields?.glAccount,
    ).toEqual({
      kind: "select",
      review: "none",
      invalidates: ["total"],
      dynamic: { visible: true, options: true, review: false, fetch: false },
    });
    expect(manifest.schema?.root.fields?.leak).toMatchObject({
      dynamic: { review: true },
    });
    expect(manifest.schema?.root.fields?.leak).not.toHaveProperty("review");
    expect(
      agent({
        instructions: "x",
        tools: {},
        schema: s.group({
          pick: s.select({ options: ["a", { id: "b", label: "B" }] }),
        }),
      }).manifest.schema?.root.fields?.pick?.options,
    ).toEqual([
      { id: "a", label: "a" },
      { id: "b", label: "B" },
    ]);
    expect(manifest.groups).toEqual(["accounts-payable", "legal"]);
    expect(manifest.schedules).toEqual([
      {
        name: "nightly-reconcile",
        cron: "0 2 * * *",
        timezone: "UTC",
        text: "Reconcile",
        previews: false,
      },
      {
        name: "weekly",
        cron: "0 9 * * MON",
        timezone: "America/New_York",
        text: "Weekly",
        previews: true,
      },
    ]);
    expect(manifest.ocr).toBe(true);
  });

  it("leaves the manifest of an agent without them unchanged", async () => {
    const plain = agent({ instructions: "x", tools: {} });
    const response = await plain.fetch(
      new Request("https://agent/manifest"),
      {},
    );
    expect(Object.keys(await response.json<Manifest>())).toEqual([
      "protocol",
      "sdk",
      "instructions",
      "model",
      "reasoning",
      "secrets",
      "mcp",
      "tools",
      "declared",
    ]);
    const evaluateResponse = await plain.fetch(
      new Request("https://agent/schema/evaluate", {
        method: "POST",
        body: "{}",
      }),
      {},
    );
    expect(evaluateResponse.status).toBe(404);
    const optionsResponse = await plain.fetch(
      new Request("https://agent/schema/options", {
        method: "POST",
        body: "{}",
      }),
      {},
    );
    expect(optionsResponse.status).toBe(404);
  });

  it("rejects invalid trees, groups and schedules", () => {
    const make = (extra: object) => () =>
      agent({ instructions: "x", tools: {}, ...extra });
    expect(make({ schema: s.text() })).toThrow(/schema must be a group/);
    expect(make({ schema: s.group({ "bad-name": s.text() }) })).toThrow(
      /field bad-name must match/,
    );
    expect(
      make({
        schema: s.group({ inner: s.group({}, { checks: { x: () => true } }) }),
      }),
    ).toThrow(/checks are only allowed on the root/);
    expect(
      make({ schema: s.group({ pick: s.select({ options: ["a", "a"] }) }) }),
    ).toThrow(/duplicate option ids/);
    expect(make({ schema: s.group({ pick: s.select({} as never) }) })).toThrow(
      /needs options/,
    );
    expect(
      make({ schema: s.group({ a: s.text({ invalidates: ["nope"] }) }) }),
    ).toThrow(/invalidates unknown path nope/);
    expect(make({ schema: s.group({ a: { kind: "text" } as never }) })).toThrow(
      /not made with the schema builders/,
    );
    expect(make({ schema: s.group({ f: s.fetched({} as never) }) })).toThrow(
      /needs inputs and fetch/,
    );
    expect(make({ groups: ["Legal"] })).toThrow(/group Legal must match/);
    expect(make({ groups: ["legal", "legal"] })).toThrow(/unique/);
    expect(
      make({ schedules: [{ name: "a", cron: "0 2 * *", text: "x" }] }),
    ).toThrow(/5-field cron/);
    expect(
      make({
        schedules: [
          { name: "a", cron: "0 2 * * *", text: "x" },
          { name: "a", cron: "0 3 * * *", text: "y" },
        ],
      }),
    ).toThrow(/declared twice/);
    expect(
      make({
        schedules: [
          { name: "a", cron: "0 2 * * *", timezone: "Mars/Base", text: "x" },
        ],
      }),
    ).toThrow(/unknown timezone/);
  });
});

describe("schema evaluate", () => {
  it("evaluates visibility, review, options and reads", async () => {
    const { fields } = await evaluate({
      answers: { "lines[0].sku": "A", "lines[2].amount": 5 },
    });
    expect(Object.keys(fields)).toEqual([
      "vendor",
      "vendorRecord",
      "currency",
      "total",
      "lines[0].sku",
      "lines[0].glAccount",
      "lines[0].amount",
      "lines[1].sku",
      "lines[1].glAccount",
      "lines[1].amount",
      "lines[2].sku",
      "lines[2].glAccount",
      "lines[2].amount",
      "approverNote",
      "leak",
    ]);
    expect(fields.vendor).toEqual({
      visible: true,
      review: "required",
      options: { kind: "source" },
      reads: [],
    });
    expect(fields.vendorRecord).toEqual({
      visible: false,
      review: "none",
      reads: ["vendor"],
    });
    expect(fields.currency).toEqual({
      visible: true,
      review: "none",
      options: {
        kind: "inline",
        items: ["USD", "EUR", "GBP"].map((id) => ({ id, label: id })),
      },
      reads: ["vendor", "vendorRecord"],
    });
    expect(fields["lines[0].glAccount"]).toMatchObject({
      visible: false,
      reads: ["vendor"],
    });
    expect(fields.approverNote).toEqual({
      visible: false,
      review: "required",
      reads: ["lines", "lines[0].amount", "lines[1].amount", "lines[2].amount"],
    });
  });

  it("resolves siblings inside list items and expands group targets", async () => {
    const { fields } = await evaluate({
      answers: { vendor: "v2", "lines[3].sku": "X9" },
      fetched: {},
      targets: ["lines[3]", "lines[3].glAccount"],
    });
    expect(Object.keys(fields)).toEqual([
      "lines[3].sku",
      "lines[3].glAccount",
      "lines[3].amount",
    ]);
    expect(fields["lines[3].glAccount"]).toEqual({
      visible: true,
      review: "none",
      options: { kind: "inline", items: [{ id: "gl-X9", label: "gl-X9" }] },
      reads: ["lines[3].sku", "vendor"],
    });
  });

  it("shows hidden fields by value threshold and reports unknown targets", async () => {
    const { fields } = await evaluate({
      answers: { "lines[0].amount": 6000, "lines[1].amount": 6000 },
      targets: ["approverNote", "nope", "lines[x]"],
    });
    expect(fields.approverNote?.visible).toBe(true);
    expect(fields.nope).toMatchObject({
      visible: false,
      error: "Unknown field nope",
    });
    expect(fields["lines[x]"]?.error).toBeDefined();
  });

  it("caches fetched data by the key of its inputs", async () => {
    fetchVendor.mockClear();
    const first = await evaluate({
      answers: { vendor: "v1" },
      targets: ["vendorRecord", "currency"],
    });
    expect(fetchVendor).toHaveBeenCalledOnce();
    const record = first.fields.vendorRecord!;
    expect(record).toMatchObject({
      visible: true,
      reads: ["vendor"],
      value: { currency: "EUR" },
      fetch: {
        key: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        data: { id: "v1", currency: "EUR", token: "[redacted:ERP_TOKEN]" },
      },
    });
    expect(first.fields.currency?.options).toEqual({
      kind: "inline",
      items: [{ id: "EUR", label: "EUR" }],
    });

    const cached = {
      vendorRecord: { key: record.fetch!.key, data: { currency: "EUR" } },
    };
    const second = await evaluate({
      answers: { vendor: "v1" },
      fetched: cached,
      targets: ["vendorRecord", "currency"],
    });
    expect(fetchVendor).toHaveBeenCalledOnce();
    expect(second.fields.vendorRecord).not.toHaveProperty("fetch");
    expect(second.fields.vendorRecord?.value).toEqual({ currency: "EUR" });

    const third = await evaluate({
      answers: { vendor: "v2" },
      fetched: cached,
      targets: ["currency"],
    });
    expect(fetchVendor).toHaveBeenCalledTimes(2);
    expect(third.fields.currency?.options).toEqual({
      kind: "inline",
      items: [{ id: "USD", label: "USD" }],
    });
    expect(third.fields.vendorRecord).toBeUndefined();
  });

  it("evaluates checks without hidden values", async () => {
    const shown = await evaluate({
      answers: {
        total: 12000,
        "lines[0].amount": 12000,
        approverNote: "ok",
      },
      targets: [],
    });
    expect(shown.checks).toEqual([
      { name: "totalsMatch", ok: true },
      { name: "noteGiven", ok: true },
    ]);
    const hidden = await evaluate({
      answers: { total: 10, "lines[0].amount": 5, approverNote: "stale" },
      targets: [],
    });
    expect(hidden.checks).toEqual([
      {
        name: "totalsMatch",
        ok: false,
        field: "total",
        message: "Lines do not add up",
      },
      { name: "noteGiven", ok: false, message: "Note missing" },
    ]);
  });

  it("turns field errors into per-field errors and redacts secrets", async () => {
    const { fields } = await evaluate({ targets: ["leak", "total"] });
    expect(fields.leak).toEqual({
      visible: true,
      review: "none",
      reads: [],
      error: "boom [redacted:ERP_TOKEN]",
    });
    expect(fields.total).toEqual({ visible: true, review: "none", reads: [] });
  });
});

describe("schema options", () => {
  it("searches, pages and gets a source", async () => {
    const first = await options({ path: "vendor", limit: 20 });
    expect(first.body.items).toHaveLength(20);
    expect(first.body).toMatchObject({ cursor: "20", total: 45 });
    const last = await options({ path: "vendor", cursor: "40", limit: 20 });
    expect(last.body.items).toHaveLength(5);
    expect(last.body.cursor).toBeUndefined();
    const found = await options({ path: "vendor", query: "acme", limit: 5 });
    expect(found.body).toEqual({
      items: [{ id: "v7", label: "Acme Supplies" }],
      total: 1,
    });
    expect(search).toHaveBeenLastCalledWith(
      "acme",
      expect.objectContaining({ limit: 5, caseId: "case_1" }),
    );
    const got = await options({ path: "vendor", ids: ["v3"], limit: 20 });
    expect(got.body).toEqual({ items: [{ id: "v3", label: "Vendor 3" }] });
  });

  it("filters and pages inline options", async () => {
    const all = await options({ path: "currency", limit: 2 });
    expect(all.body).toEqual({
      items: [
        { id: "USD", label: "USD" },
        { id: "EUR", label: "EUR" },
      ],
      cursor: "2",
      total: 3,
    });
    const next = await options({ path: "currency", limit: 2, cursor: "2" });
    expect(next.body).toEqual({
      items: [{ id: "GBP", label: "GBP" }],
      total: 3,
    });
    const found = await options({ path: "currency", query: "eu", limit: 20 });
    expect(found.body).toEqual({
      items: [{ id: "EUR", label: "EUR" }],
      total: 1,
    });
    const sibling = await options({
      path: "lines[4].glAccount",
      answers: { "lines[4].sku": "Q" },
      limit: 20,
    });
    expect(sibling.body.items).toEqual([{ id: "gl-Q", label: "gl-Q" }]);
  });

  it("refuses fields without options", async () => {
    const response = await options({ path: "total", limit: 20 });
    expect(response.status).toBe(400);
  });
});

describe("effects", () => {
  const call = async (name: string, input: unknown) => {
    const response = await invoices.fetch(
      new Request(`https://agent/tools/${name}`, {
        method: "POST",
        body: JSON.stringify({ input, case: { id: "c" }, callId: "1" }),
      }),
      env,
    );
    return response.json<ToolResult>();
  };

  it("returns waitOn and tag effects for declared groups", async () => {
    expect(await call("escalate", { group: "accounts-payable" })).toEqual({
      output: "ok",
      isError: false,
      effects: [
        { type: "wait", group: "accounts-payable", reason: "Vendor not found" },
        {
          type: "tag",
          group: "legal",
          message: "Check terms [redacted:ERP_TOKEN]",
        },
      ],
    });
    expect(await call("plain", {})).toEqual({ output: "ok", isError: false });
  });

  it("refuses undeclared groups", async () => {
    expect(await call("escalate", { group: "finance" })).toEqual({
      output: "Group finance is not declared in this agent's groups list",
      isError: true,
      threw: true,
    });
  });
});
