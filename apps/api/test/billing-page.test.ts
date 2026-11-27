// The Billing page's data (PRE-94): who sees the card, billing email,
// invoices and payment trouble on GET /billing; the month so far from our own
// ledger, floored to the cent; the payment portal; and what the Owner must do
// when a purchase can't be charged to the card on file. Autumn's API is
// stubbed; nothing here leaves the test.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import {
  agentGrants,
  agents,
  groupMembers,
  groups,
} from "@preprocess/db/schema/access";
import {
  seatActivity,
  usageRecords,
  usageReports,
} from "@preprocess/db/schema/billing";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { evalRuns, evalSuites } from "@preprocess/db/schema/evals";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env.ts";
import { monthOf } from "../src/metering.ts";
import { addMember, createOrganization, signUp, testEnv } from "./helpers.ts";

type Call = { route: string; body: Record<string, unknown> };
let calls: Call[] = [];
let customer: Record<string, unknown> = {};
let attached: Record<string, unknown> = { payment_url: null };

const stubAutumn = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.useautumn.com")
      throw new Error(`unexpected fetch to ${url.hostname}`);
    const route = url.pathname.replace("/v1/", "");
    const body = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    ) as Record<string, unknown>;
    calls.push({ route, body });
    const json = (value: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(value), {
          headers: { "content-type": "application/json" },
        }),
      );
    if (route === "customers.get_or_create") {
      const expand = (body.expand as string[] | undefined) ?? [];
      const { invoices, payment_method, ...rest } = customer;
      return json({
        id: body.customer_id,
        ...rest,
        ...(expand.includes("invoices") && { invoices }),
        ...(expand.includes("payment_method") && { payment_method }),
      });
    }
    if (route === "billing.open_customer_portal")
      return json({
        customer_id: body.customer_id,
        url: "https://billing.stripe.com/p/session/test",
      });
    if (route === "billing.attach" || route === "billing.multi_attach")
      return json(attached);
    return json({});
  });

const env: Env = testEnv({
  AUTUMN_SECRET_KEY: "am_sk_test_stub",
  APP_URL: "https://app.example.test",
});

const visa = {
  card: { brand: "visa", last4: "4242", exp_month: 8, exp_year: 2028 },
};

const invoice = (id: string, at: number, total: number, status = "paid") => ({
  id,
  plan_ids: ["team"],
  stripe_id: `in_${id}`,
  status,
  total,
  currency: "usd",
  created_at: at,
  hosted_invoice_url: `https://invoice.stripe.com/i/${id}`,
});

const team = (extra: Record<string, unknown> = {}) => ({
  subscriptions: [{ plan_id: "team", status: "active" }],
  flags: {},
  balances: {
    model_credit: {
      granted: 10_037,
      remaining: 10_037,
      usage: 0,
      unlimited: false,
    },
  },
  email: "billing@acme.example",
  payment_method: visa,
  invoices: [
    invoice("aug", Date.UTC(2026, 7, 1), 176.12),
    invoice("oct", Date.UTC(2026, 9, 1), 214.8, "open"),
    invoice("jul", Date.UTC(2026, 6, 1), 150),
    invoice("sep", Date.UTC(2026, 8, 1), 198.36),
  ],
  ...extra,
});

const organization = async (name: string) => {
  const owner = await signUp(name, env);
  const org = await createOrganization(owner.client, name);
  const admin = await addMember(owner.client, org, `${name} Admin`, "admin");
  const member = await addMember(owner.client, org, `${name} Member`);
  return { org, owner, admin, member };
};

afterEach(() => {
  vi.restoreAllMocks();
  calls = [];
  attached = { payment_url: null };
});

const customerReads = () =>
  calls.filter((c) => c.route === "customers.get_or_create");

describe("GET /billing", () => {
  it("shows the card, billing email and newest 3 invoices to the Owner alone, and a failed payment to Owners and Admins", async () => {
    const shop = await organization("Pageco");
    stubAutumn();
    customer = team({
      subscriptions: [{ plan_id: "team", status: "active", past_due: true }],
    });
    const path = `/v1/orgs/${shop.org}/billing`;
    const owner = await shop.owner.client.call<{ invoices: unknown[] }>(path);
    expect(owner.status).toBe(200);
    expect(owner.body).toMatchObject({
      plan: "team",
      credits: { remaining: 10_037, owed: 0 },
      card: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 },
      email: "billing@acme.example",
      pastDue: true,
      invoices: [
        {
          id: "oct",
          at: "2026-10-01T00:00:00.000Z",
          totalUsd: 214.8,
          status: "open",
          url: "https://invoice.stripe.com/i/oct",
        },
        { id: "sep", totalUsd: 198.36, status: "paid" },
        { id: "aug", totalUsd: 176.12 },
      ],
      commit: null,
    });
    expect(owner.body.invoices).toHaveLength(3);
    expect(customerReads().at(-1)?.body.expand).toEqual([
      "invoices",
      "payment_method",
    ]);

    calls = [];
    const admin = await shop.admin.client.call(path);
    expect(admin.status).toBe(200);
    expect(admin.body).toMatchObject({
      card: null,
      email: null,
      pastDue: true,
      invoices: [],
      commit: null,
    });
    expect(customerReads().some((c) => c.body.expand)).toBe(false);

    const member = await shop.member.client.call(path);
    expect(member.body).toMatchObject({
      card: null,
      email: null,
      pastDue: false,
      invoices: [],
    });

    customer = team();
    const paid = await shop.owner.client.call(path);
    expect(paid.body).toMatchObject({ pastDue: false });
  });

  it("reads Enterprise's annual commit, floored to the cent", async () => {
    const big = await organization("Commitco");
    stubAutumn();
    customer = {
      subscriptions: [{ plan_id: "enterprise", status: "active" }],
      flags: {},
      balances: {
        commit: {
          granted: 5_000_000,
          usage: 3_142_000.9,
          remaining: 1_857_999.1,
          unlimited: false,
        },
      },
      email: "ap@acme.example",
      invoices: [invoice("e1", Date.UTC(2026, 9, 1), 3_212.44)],
    };
    const path = `/v1/orgs/${big.org}/billing`;
    const owner = await big.owner.client.call(path);
    expect(owner.body).toMatchObject({
      plan: "enterprise",
      credits: null,
      autoReload: null,
      card: null,
      email: "ap@acme.example",
      invoices: [{ id: "e1", totalUsd: 3_212.44 }],
      commit: { usedUsd: 31_420, totalUsd: 50_000 },
    });
    const admin = await big.admin.client.call(path);
    expect(admin.body).toMatchObject({
      commit: { usedUsd: 31_420, totalUsd: 50_000 },
      email: null,
      invoices: [],
    });
  });

  it("never reads the customer's details for Internal", async () => {
    const ours = await organization("Oursco");
    stubAutumn();
    customer = {
      subscriptions: [{ plan_id: "internal", status: "active" }],
      flags: {},
      balances: {},
      email: "us@preprocess.example",
      payment_method: visa,
    };
    const read = await ours.owner.client.call(`/v1/orgs/${ours.org}/billing`);
    expect(read.body).toMatchObject({
      plan: "internal",
      card: null,
      email: null,
      invoices: [],
      pastDue: false,
      commit: null,
    });
    expect(customerReads()).toHaveLength(1);
    expect(customerReads()[0]?.body.expand).toBeUndefined();
  });
});

describe("GET /billing/usage", () => {
  it("adds up this month from the ledger, seats and storage reports, floored to the cent, with every day so far", async () => {
    const shop = await organization("Usageco");
    const operator = await addMember(shop.owner.client, shop.org, "Usage Op");
    stubAutumn();
    customer = team();
    const now = new Date();
    const month = monthOf(now);
    const start = new Date(`${month}T00:00:00Z`);
    const firstDay = new Date(start.getTime() + 3_600_000);
    const lastMonth = new Date(start.getTime() - 3_600_000);
    const previous = monthOf(lastMonth).slice(0, 7);
    const yyyymm = month.slice(0, 7);
    const record = (feature: string, quantity: number, at: Date) => ({
      id: newId("usageRecord"),
      organizationId: shop.org,
      feature: feature as "cases",
      quantity,
      at,
    });
    await withOrg(env, orgId(shop.org), async (tx) => {
      const [agent] = await tx
        .insert(agents)
        .values({ id: newId("agent"), organizationId: shop.org, slug: "ap" })
        .returning({ id: agents.id });
      const group = newId("group");
      await tx.insert(groups).values({
        id: group,
        organizationId: shop.org,
        slug: "ops",
        name: "Ops",
      });
      await tx.insert(groupMembers).values([
        { organizationId: shop.org, groupId: group, userId: operator.userId },
        { organizationId: shop.org, groupId: group, userId: shop.owner.userId },
      ]);
      await tx.insert(agentGrants).values({
        organizationId: shop.org,
        agentId: agent!.id,
        groupId: group,
        access: "operator",
        grantedBy: shop.owner.userId,
      });
      await tx.insert(seatActivity).values([
        {
          organizationId: shop.org,
          userId: shop.owner.userId,
          month,
          role: "developer",
        },
        {
          organizationId: shop.org,
          userId: operator.userId,
          month,
          role: "operator",
        },
      ]);
      await tx
        .insert(usageRecords)
        .values([
          record("cases", 4_000, firstDay),
          record("model_usage", 20_000_000, firstDay),
          record("decide", 2_940_000, firstDay),
          record("case_fees", 64_000_000, firstDay),
          record("cases", 200, now),
          record("model_usage", 3_845_000, now),
          record("model_usage", 4_999, now),
          record("ocr", 5_250_000, now),
          record("sandbox", 3_600_000, now),
          record("log_bytes", 900, now),
          record("model_usage", 99_000_000, lastMonth),
        ]);
      await tx.insert(usageReports).values([
        {
          id: `storage:${shop.org}:${previous}-28`,
          organizationId: shop.org,
          feature: "storage_gb_months",
          seq: 1,
          quantity: 0,
          remainder: 400_000,
        },
        {
          id: `storage:${shop.org}:${yyyymm}-01`,
          organizationId: shop.org,
          feature: "storage_gb_months",
          seq: 2,
          quantity: 1,
          remainder: 600_000,
        },
        {
          id: `storage:${shop.org}:${yyyymm}-02`,
          organizationId: shop.org,
          feature: "storage_gb_months",
          seq: 3,
          quantity: 50,
          remainder: 634_567,
        },
      ]);
    });

    const path = `/v1/orgs/${shop.org}/billing/usage`;
    const usage = await shop.owner.client.call<{
      daily: { day: string; usd: number }[];
    }>(path);
    expect(usage.status).toBe(200);
    expect(usage.body).toMatchObject({
      month: yyyymm,
      seats: { count: 2, includedCount: 0, usd: 32 },
      cases: { count: 4_200, includedCount: 1_000, usd: 64 },
      modelUsageUsd: 23.84,
      decideUsd: 2.94,
      ocrUsd: 5.25,
      sandboxUsd: 3.6,
      storage: { gbMonths: 51.234567, includedGbMonths: 50, usd: 0.12 },
      byAgent: [
        {
          agentId: null,
          slug: null,
          cases: 4_200,
          casesUsd: 64,
          modelUsageUsd: 23.84,
          decideUsd: 2.94,
          ocrUsd: 5.25,
          sandboxUsd: 3.6,
        },
      ],
      paidFromCreditsUsd: 99.63,
      billedAtMonthEndUsd: 32.12,
      now: {
        seats: 2,
        seatLimit: null,
        casesThisMonth: 4_200,
        caseLimit: null,
        storageIncludedGb: 50,
      },
    });
    const today = now.getUTCDate();
    expect(usage.body.daily.map((d) => d.day)).toEqual(
      Array.from(
        { length: today },
        (_, i) => `${yyyymm}-${String(i + 1).padStart(2, "0")}`,
      ),
    );
    const byDay = Object.fromEntries(
      usage.body.daily.map((d) => [d.day, d.usd]),
    );
    if (today === 1) expect(byDay[`${yyyymm}-01`]).toBe(99.63);
    else {
      expect(byDay[`${yyyymm}-01`]).toBe(86.94);
      expect(byDay[usage.body.daily.at(-1)!.day]).toBe(12.69);
      expect(usage.body.daily.slice(1, -1).every((d) => d.usd === 0)).toBe(
        true,
      );
    }

    expect((await shop.admin.client.call(path)).status).toBe(403);
    expect((await shop.member.client.call(path)).status).toBe(403);
  });

  it("splits each line by agent through cases and eval cases, adding up to the line exactly, and never shows another organization's usage", async () => {
    const shop = await organization("Splitco");
    const other = await organization("Splitother");
    stubAutumn();
    customer = team();
    const at = new Date();
    type Line =
      "cases" | "case_fees" | "model_usage" | "decide" | "ocr" | "sandbox";
    const seed = async (
      org: string,
      owner: string,
      records: (
        slugs: Record<string, string[]>,
      ) => [Line, number, (string | undefined)?][],
    ) => {
      const ids: Record<string, string[]> = {};
      await withOrg(env, orgId(org), async (tx) => {
        for (const slug of ["invoices", "claims"]) {
          const agentId = newId("agent");
          const deploymentId = newId("deployment");
          await tx
            .insert(agents)
            .values({ id: agentId, organizationId: org, slug });
          await tx.insert(deployments).values({
            id: deploymentId,
            organizationId: org,
            agentId,
            environment: "production",
            status: "ready",
            bundleSha256: "00",
            sdkVersion: "0.1.0",
            manifest: {},
            source: "cli",
            createdBy: owner,
          });
          const caseIds = [newId("case"), newId("case")];
          await tx.insert(cases).values(
            caseIds.map((id) => ({
              id,
              organizationId: org,
              agentId,
              deploymentId,
              status: "completed" as const,
              source: "api" as const,
            })),
          );
          const suite = newId("evalSuite");
          const run = newId("evalRun");
          await tx.insert(evalSuites).values({
            id: suite,
            organizationId: org,
            agentId,
            name: "Golden",
            kind: "manual",
            createdBy: owner,
          });
          await tx.insert(evalRuns).values({
            id: run,
            organizationId: org,
            suiteId: suite,
            deploymentId,
            model: "test",
            trigger: "manual",
            status: "completed",
            createdBy: owner,
          });
          ids[slug] = [...caseIds, `eval:${run}:${caseIds[0]}`];
        }
        await tx.insert(usageRecords).values(
          records(ids).map(([feature, quantity, caseId]) => ({
            id: newId("usageRecord"),
            organizationId: org,
            feature,
            quantity,
            caseId: caseId ?? null,
            at,
          })),
        );
      });
    };
    await seed(shop.org, shop.owner.userId, ({ invoices, claims }) => {
      const [i1, i2] = invoices!;
      const [c1, , cEval] = claims!;
      return [
        ["cases", 1, i1],
        ["cases", 1, i2],
        ["cases", 1, c1],
        ["case_fees", 20_000, i1],
        ["case_fees", 20_000, i2],
        ["case_fees", 20_000, c1],
        ["model_usage", 3_333, i1],
        ["model_usage", 3_333, i2],
        ["model_usage", 3_334, c1],
        ["model_usage", 6_666, cEval],
        ["decide", 7_000, i1],
        ["decide", 4_000, c1],
        ["decide", 6_000],
        ["ocr", 5_250_000],
        ["ocr", 10_000, "case_gone"],
        ["sandbox", 3_600_000, i2],
      ];
    });
    await seed(other.org, other.owner.userId, ({ invoices }) => [
      ["cases", 1, invoices![0]],
      ["case_fees", 9_000_000, invoices![0]],
      ["model_usage", 77_000_000, invoices![0]],
      ["ocr", 1_000_000],
    ]);

    const path = `/v1/orgs/${shop.org}/billing/usage`;
    type Agent = {
      agentId: string | null;
      slug: string | null;
      cases: number;
      casesUsd: number;
      modelUsageUsd: number;
      decideUsd: number;
      ocrUsd: number;
      sandboxUsd: number;
    };
    const usage = await shop.owner.client.call<{
      cases: { count: number; usd: number };
      modelUsageUsd: number;
      decideUsd: number;
      ocrUsd: number;
      sandboxUsd: number;
      byAgent: Agent[];
    }>(path);
    expect(usage.status).toBe(200);
    const u = usage.body;
    expect(u).toMatchObject({
      cases: { count: 3, usd: 0.06 },
      modelUsageUsd: 0.01,
      decideUsd: 0.01,
      ocrUsd: 5.26,
      sandboxUsd: 3.6,
    });
    expect(u.byAgent.map(({ agentId: _, ...rest }) => rest)).toEqual([
      {
        slug: "claims",
        cases: 1,
        casesUsd: 0.02,
        modelUsageUsd: 0.01,
        decideUsd: 0,
        ocrUsd: 0,
        sandboxUsd: 0,
      },
      {
        slug: "invoices",
        cases: 2,
        casesUsd: 0.04,
        modelUsageUsd: 0,
        decideUsd: 0.01,
        ocrUsd: 0,
        sandboxUsd: 3.6,
      },
      {
        slug: null,
        cases: 0,
        casesUsd: 0,
        modelUsageUsd: 0,
        decideUsd: 0,
        ocrUsd: 5.26,
        sandboxUsd: 0,
      },
    ]);
    expect(u.byAgent.at(-1)!.agentId).toBeNull();
    const total = (pick: (a: Agent) => number) =>
      u.byAgent.reduce((all, a) => all + Math.round(pick(a) * 100), 0);
    expect(total((a) => a.cases)).toBe(u.cases.count * 100);
    expect(total((a) => a.casesUsd)).toBe(Math.round(u.cases.usd * 100));
    expect(total((a) => a.modelUsageUsd)).toBe(
      Math.round(u.modelUsageUsd * 100),
    );
    expect(total((a) => a.decideUsd)).toBe(Math.round(u.decideUsd * 100));
    expect(total((a) => a.ocrUsd)).toBe(Math.round(u.ocrUsd * 100));
    expect(total((a) => a.sandboxUsd)).toBe(Math.round(u.sandboxUsd * 100));

    expect((await shop.admin.client.call(path)).status).toBe(403);
    expect((await shop.member.client.call(path)).status).toBe(403);
    expect((await other.owner.client.call(path)).status).not.toBe(200);
  });

  it("includes Free's seats, cases and 5 GB, and bills only storage past it", async () => {
    const shop = await organization("Freeusage");
    stubAutumn();
    customer = {
      subscriptions: [{ plan_id: "free", status: "active" }],
      flags: {},
      balances: {
        seats: { granted: 3, remaining: 3, usage: 0, unlimited: false },
        model_credit: {
          granted: 500,
          remaining: 318,
          usage: 182,
          unlimited: false,
        },
      },
    };
    const yyyymm = monthOf(new Date()).slice(0, 7);
    await withOrg(env, orgId(shop.org), (tx) =>
      tx.insert(usageReports).values({
        id: `storage:${shop.org}:${yyyymm}-01`,
        organizationId: shop.org,
        feature: "storage_gb_months",
        seq: 1,
        quantity: 5,
        remainder: 999_999,
      }),
    );
    const usage = await shop.owner.client.call(
      `/v1/orgs/${shop.org}/billing/usage`,
    );
    expect(usage.body).toMatchObject({
      seats: { includedCount: 3, usd: 0 },
      cases: { count: 0, includedCount: 1_000, usd: 0 },
      storage: { gbMonths: 5.999999, includedGbMonths: 5, usd: 0.09 },
      paidFromCreditsUsd: 0,
      billedAtMonthEndUsd: 0.09,
      now: { seatLimit: 3, caseLimit: 1_000, storageIncludedGb: 5 },
    });
  });

  it("is not there where billing is off", async () => {
    const off = testEnv({ APP_URL: "https://app.example.test" });
    const owner = await signUp("Offco", off);
    const org = await createOrganization(owner.client, "Offco");
    expect(
      (await owner.client.call(`/v1/orgs/${org}/billing/usage`)).status,
    ).toBe(404);
    expect(
      (
        await owner.client.call(`/v1/orgs/${org}/billing/portal`, {
          body: {},
        })
      ).status,
    ).toBe(404);
  });
});

describe("POST /billing/portal", () => {
  it("opens the payment portal for the Owner alone, returning only to this app", async () => {
    const shop = await organization("Portalco");
    stubAutumn();
    customer = team();
    const path = `/v1/orgs/${shop.org}/billing/portal`;
    const opened = await shop.owner.client.call(path, {
      body: {
        returnTo: "https://app.example.test/settings/organization/billing",
      },
    });
    expect(opened.status).toBe(200);
    expect(opened.body).toEqual({
      url: "https://billing.stripe.com/p/session/test",
    });
    expect(
      calls.find((c) => c.route === "billing.open_customer_portal")?.body,
    ).toEqual({
      customer_id: shop.org,
      return_url: "https://app.example.test/settings/organization/billing",
    });
    calls = [];
    expect((await shop.owner.client.call(path, { body: {} })).status).toBe(200);
    expect(
      calls.find((c) => c.route === "billing.open_customer_portal")?.body
        .return_url,
    ).toBe("https://app.example.test/");
    expect(
      (
        await shop.owner.client.call(path, {
          body: { returnTo: "https://evil.example/billing" },
        })
      ).status,
    ).toBe(400);
    calls = [];
    expect((await shop.admin.client.call(path, { body: {} })).status).toBe(403);
    expect((await shop.member.client.call(path, { body: {} })).status).toBe(
      403,
    );
    expect(calls.some((c) => c.route === "billing.open_customer_portal")).toBe(
      false,
    );
  });

  it("is not there for an organization without a plan before billing holds for it", async () => {
    const early = await organization("Earlyportalco");
    stubAutumn();
    customer = { subscriptions: [], flags: {}, balances: {} };
    expect(
      (
        await early.owner.client.call(`/v1/orgs/${early.org}/billing/portal`, {
          body: {},
        })
      ).status,
    ).toBe(404);
    expect(calls.some((c) => c.route === "billing.open_customer_portal")).toBe(
      false,
    );
  });
});

describe("payment actions", () => {
  const page = "https://invoice.stripe.com/i/pay";

  it("say why a credit purchase needs the payment page, from Autumn's required action", async () => {
    const shop = await organization("Actionco");
    stubAutumn();
    customer = team();
    const path = `/v1/orgs/${shop.org}/billing/credits`;
    const buy = async (requiredAction: string | null) => {
      attached = {
        payment_url: page,
        required_action: requiredAction && {
          code: requiredAction,
          reason: "test",
        },
      };
      return (await shop.owner.client.call(path, { body: { credits: 10_000 } }))
        .body;
    };
    expect(await buy("3ds_required")).toEqual({
      url: page,
      action: "confirm_payment",
    });
    expect(await buy("payment_failed")).toEqual({
      url: page,
      action: "card_declined",
    });
    expect(await buy("payment_method_required")).toEqual({
      url: page,
      action: "add_card",
    });
    expect(await buy("something_new")).toEqual({ url: page, action: null });
    customer = team({ payment_method: null });
    expect(await buy(null)).toEqual({ url: page, action: "add_card" });
  });

  it("send a new card to the payment page instead of charging the card on file", async () => {
    const shop = await organization("Newcardco");
    stubAutumn();
    customer = team();
    attached = { payment_url: "https://checkout.stripe.com/c/pay/cs_new" };
    const bought = await shop.owner.client.call(
      `/v1/orgs/${shop.org}/billing/credits`,
      { body: { credits: 10_000, newCard: true } },
    );
    expect(bought.body).toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_new",
      action: null,
    });
    expect(calls.find((c) => c.route === "billing.attach")?.body).toEqual({
      customer_id: shop.org,
      plan_id: "credits",
      feature_quantities: [{ feature_id: "model_credit", quantity: 10_000 }],
      success_url: "https://app.example.test/",
      redirect_mode: "always",
    });
  });

  it("say why a plan change or Team's checkout needs the payment page, and whether Team was paid", async () => {
    const up = await organization("Upactionco");
    stubAutumn();
    customer = {
      subscriptions: [{ plan_id: "free", status: "active" }],
      flags: {},
      balances: {},
      payment_method: visa,
    };
    attached = {
      payment_url: page,
      required_action: { code: "3ds_required", reason: "test" },
    };
    const changed = await up.owner.client.call(
      `/v1/orgs/${up.org}/billing/plan`,
      { body: { plan: "team" } },
    );
    expect(changed.body).toEqual({ url: page, action: "confirm_payment" });

    const fresh = await organization("Checkoutactionco");
    env.BILLING_ENFORCED_ORGS = fresh.org;
    customer = { subscriptions: [], flags: {}, balances: {} };
    attached = {
      payment_url: page,
      required_action: { code: "payment_failed", reason: "Card was declined" },
    };
    const path = `/v1/orgs/${fresh.org}/billing/checkout`;
    expect(
      (await fresh.owner.client.call(path, { body: { plan: "team" } })).body,
    ).toEqual({ url: page, paid: false, action: "card_declined" });
    attached = { payment_url: null };
    expect(
      (await fresh.owner.client.call(path, { body: { plan: "team" } })).body,
    ).toEqual({ url: "https://app.example.test/", paid: true, action: null });
  });
});
