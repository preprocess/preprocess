// Billing on our cloud (spec 16a): metered usage reaches Autumn exactly once,
// active seats count only people who hold a paid seat, the plan comes from
// Autumn, and Free's caps stop new cases and model calls. Autumn's API is
// stubbed; nothing here leaves the test.

import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
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
import { deployments } from "@preprocess/db/schema/deployments";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  activeSeats,
  creditStop,
  entitlement,
  planRequired,
  readPlan,
  reportUsage,
  seatLimitApplies,
} from "../src/billing.ts";
import type { Env } from "../src/env.ts";
import { caseFeeMicroUsd, monthOf } from "../src/metering.ts";
import { customImagesAllowed, getPlan } from "../src/plan.ts";
import { Platform } from "../src/platform.ts";
import { monthSpendParts } from "../src/spend.ts";
import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";

type Call = {
  route: string;
  body: Record<string, unknown>;
  key: string | null;
};
let calls: Call[] = [];
let customer: {
  subscriptions: { plan_id: string; status: string }[];
  flags: Record<string, unknown>;
  balances: Record<string, unknown>;
  billing_controls?: { auto_topups?: unknown[] };
  payment_method?: { card: { brand: string; last4: string } };
};
let allowed = true;
let paymentUrl: string | null = null;

const stubAutumn = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.useautumn.com")
      throw new Error(`unexpected fetch to ${url.hostname}`);
    const route = url.pathname.replace("/v1/", "");
    const body = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    ) as Record<string, unknown>;
    const key = new Headers(init?.headers).get("idempotency-key");
    calls.push({ route, body, key });
    const json = (value: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(value), {
          headers: { "content-type": "application/json" },
        }),
      );
    if (route === "customers.get_or_create")
      return json({ id: body.customer_id, ...customer });
    if (route === "check") return json({ allowed });
    if (route === "billing.setup_payment")
      return json({ url: "https://checkout.stripe.com/c/pay/cs_test" });
    if (route === "billing.preview_attach")
      return json({
        line_items: [{ description: "Team - Active seats", total: 0 }],
        total: 0,
        currency: "usd",
        next_cycle: { starts_at: Date.UTC(2026, 11, 1), total: 16 },
      });
    if (route === "customers.update") {
      customer.billing_controls = body.billing_controls as never;
      return json({ id: body.customer_id, ...customer });
    }
    if (route === "billing.attach" && body.plan_id === "credits")
      return json({ payment_url: paymentUrl });
    if (route === "billing.attach") {
      customer.subscriptions = [
        { plan_id: String(body.plan_id), status: "active" },
      ];
      return json({ payment_url: null });
    }
    return json({});
  });

const environment: Env = testEnv({
  AUTUMN_SECRET_KEY: "am_sk_test_stub",
  CASES: { send: () => Promise.resolve() } as unknown as Queue,
});

let org: string;
let ownerId: string;
let ownerClient: Client;

// An organization with an agent ready to take cases, and an API key for it.
const organizationWithAgent = async (name: string, env = environment) => {
  const owner = await signUp(name, env);
  const id = await createOrganization(owner.client, name);
  const key = await owner.client.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "ci", organizationId: id } },
  );
  const agentId = newId("agent");
  await withOrg(environment, orgId(id), async (tx) => {
    await tx
      .insert(agents)
      .values({ id: agentId, organizationId: id, slug: "invoices" });
    await tx.insert(deployments).values({
      id: newId("deployment"),
      organizationId: id,
      agentId,
      environment: "production",
      status: "ready",
      bundleSha256: "00",
      sdkVersion: "0.1.0",
      manifest: {},
      source: "cli",
      createdBy: owner.userId,
      promotedAt: new Date(),
    });
  });
  return {
    org: id,
    ownerId: owner.userId,
    owner: owner.client,
    keyed: new Client(env, { "x-api-key": key.body.key }),
  };
};

beforeAll(async () => {
  const owner = await signUp("Biller", environment);
  ownerId = owner.userId;
  ownerClient = owner.client;
  org = await createOrganization(owner.client, "Billco");
  const agentId = newId("agent");
  await withOrg(environment, orgId(org), async (tx) => {
    await tx
      .insert(agents)
      .values({ id: agentId, organizationId: org, slug: "invoices" });
    await tx.insert(deployments).values({
      id: newId("deployment"),
      organizationId: org,
      agentId,
      environment: "production",
      status: "ready",
      bundleSha256: "00",
      sdkVersion: "0.1.0",
      manifest: {},
      source: "cli",
      createdBy: ownerId,
      promotedAt: new Date(),
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  calls = [];
  allowed = true;
  paymentUrl = null;
});

const balance = (remaining: number, granted = remaining, usage = 0) => ({
  granted,
  remaining,
  usage,
  unlimited: false,
});

describe("reporting usage", () => {
  it("sends each unreported record once, in whole units, and never log bytes", async () => {
    stubAutumn();
    customer = { subscriptions: [], flags: {}, balances: {} };
    await withOrg(environment, orgId(org), (tx) =>
      tx.insert(usageRecords).values([
        {
          id: newId("usageRecord"),
          organizationId: org,
          feature: "cases",
          quantity: 1,
        },
        {
          id: newId("usageRecord"),
          organizationId: org,
          feature: "cases",
          quantity: 1,
        },
        {
          id: newId("usageRecord"),
          organizationId: org,
          feature: "model_usage",
          quantity: 24_200,
        },
        {
          id: newId("usageRecord"),
          organizationId: org,
          feature: "log_bytes",
          quantity: 900,
        },
      ]),
    );
    await reportUsage(environment);
    // Other test files report usage too, so read what was reported for this
    // organization rather than which run sent it.
    const reported = () =>
      withOrg(environment, orgId(org), (tx) =>
        tx
          .select({
            feature: usageReports.feature,
            quantity: usageReports.quantity,
            remainder: usageReports.remainder,
            reportedAt: usageReports.reportedAt,
          })
          .from(usageReports)
          .orderBy(usageReports.feature),
      );
    const first = await reported();
    expect(first.map((r) => [r.feature, r.quantity, r.remainder])).toEqual([
      ["cases", 2, 0],
      ["model_usage_credits", 2, 4_200],
    ]);
    expect(first.every((r) => r.reportedAt)).toBe(true);
    await reportUsage(environment);
    expect(await reported()).toEqual(first);
  });

  it("sends nothing where billing is off", async () => {
    stubAutumn();
    await reportUsage(testEnv());
    expect(calls).toEqual([]);
  });
});

describe("active seats", () => {
  it("counts people who worked this month and hold a paid seat, once each", async () => {
    const month = monthOf(new Date());
    const operator = (await addMember(ownerClient, org, "Op")).userId;
    const viewer = (await addMember(ownerClient, org, "View")).userId;
    await withOrg(environment, orgId(org), async (tx) => {
      const [agent] = await tx.select({ id: agents.id }).from(agents);
      const ap = newId("group");
      const readers = newId("group");
      await tx.insert(groups).values([
        { id: ap, organizationId: org, slug: "ap", name: "AP" },
        { id: readers, organizationId: org, slug: "readers", name: "Readers" },
      ]);
      await tx.insert(groupMembers).values([
        { organizationId: org, groupId: ap, userId: operator },
        { organizationId: org, groupId: readers, userId: viewer },
      ]);
      await tx.insert(agentGrants).values([
        {
          organizationId: org,
          agentId: agent!.id,
          groupId: ap,
          access: "operator",
          grantedBy: ownerId,
        },
        {
          organizationId: org,
          agentId: agent!.id,
          groupId: readers,
          access: "viewer",
          grantedBy: ownerId,
        },
      ]);
      // The Owner is in no paid group: free, whatever they did.
      await tx.insert(seatActivity).values([
        { organizationId: org, userId: operator, month, role: "operator" },
        { organizationId: org, userId: operator, month, role: "developer" },
        { organizationId: org, userId: viewer, month, role: "operator" },
        { organizationId: org, userId: ownerId, month, role: "operator" },
      ]);
    });
    expect(
      await withoutOrg(environment, "test: seats", (tx) =>
        activeSeats(tx, org, month),
      ),
    ).toBe(1);
  });
});

describe("the plan", () => {
  it("reads Free's seat limit and Enterprise's features from Autumn", async () => {
    expect(
      readPlan({
        id: org,
        subscriptions: [{ plan_id: "free", status: "active" }],
        flags: {},
        balances: {
          seats: { granted: 3, remaining: 3, usage: 0, unlimited: false },
        },
      }),
    ).toMatchObject({ name: "free", seats: 3, started: true });
    stubAutumn();
    customer = {
      subscriptions: [{ plan_id: "enterprise", status: "active" }],
      flags: { sso: {}, audit_export: {}, training: {} },
      balances: {},
    };
    const plan = await getPlan(environment, orgId(org));
    expect(plan.name).toBe("enterprise");
    expect(plan.features).toEqual(["audit_export", "sso"]);
    expect(plan.limits.seats).toBeNull();
  });

  it("allows custom sandbox images on Team and not on Free", async () => {
    const team = await organizationWithAgent("Imageco");
    const free = await organizationWithAgent("Presetco");
    stubAutumn();
    customer = {
      subscriptions: [{ plan_id: "team", status: "active" }],
      flags: { training: {}, custom_sandbox_images: {} },
      balances: {},
    };
    expect(await customImagesAllowed(environment, orgId(team.org))).toBe(true);
    customer = {
      subscriptions: [{ plan_id: "free", status: "active" }],
      flags: {},
      balances: {},
    };
    expect(await customImagesAllowed(environment, orgId(free.org))).toBe(false);
  });

  it("is free and unlimited where billing is off", async () => {
    const plan = await getPlan(testEnv(), orgId(org));
    expect(plan).toMatchObject({ name: "free", limits: { seats: null } });
  });
});

describe("Free's caps", () => {
  it("refuse a new case once the month's cases are used, and halt model calls once the credits are", async () => {
    const capped = await organizationWithAgent("Capped");
    stubAutumn();
    customer = {
      subscriptions: [{ plan_id: "free", status: "active" }],
      flags: {},
      balances: {},
    };
    allowed = false;
    const refused = await capped.keyed.call<{ error: { code: string } }>(
      `/v1/orgs/${capped.org}/cases`,
      { body: { agent: "invoices", text: "over the cap" } },
    );
    expect(refused.status).toBe(402);
    expect(refused.body.error.code).toBe("credit_exhausted");
    const gate = new Platform({} as ExecutionContext, environment);
    expect(await gate.spendGate(capped.org)).toBe("credit_exhausted");
    expect(
      calls.filter((c) => c.route === "check").map((c) => c.body.feature_id),
    ).toEqual(["cases"]);
  });

  it("fail open when Autumn is down", async () => {
    const down = await organizationWithAgent("Down");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("outage"));
    const created = await down.keyed.call(`/v1/orgs/${down.org}/cases`, {
      body: { agent: "invoices", text: "during an outage" },
    });
    expect(created.status).toBe(202);
  });
});

describe("starting a plan", () => {
  const requiredFrom = (at: Date) =>
    testEnv({
      AUTUMN_SECRET_KEY: "am_sk_test_stub",
      BILLING_REQUIRED_FROM: at.toISOString(),
      CASES: { send: () => Promise.resolve() } as unknown as Queue,
    });
  const attached = () =>
    calls
      .filter((c) => c.route === "billing.attach")
      .map((c) => c.body.plan_id);

  it("limits nothing without a plan until cards are required", async () => {
    const early = await organizationWithAgent("Early");
    stubAutumn();
    customer = { subscriptions: [], flags: {}, balances: {} };
    const created = await early.keyed.call(`/v1/orgs/${early.org}/cases`, {
      body: { agent: "invoices", text: "before cards are required" },
    });
    expect(created.status).toBe(202);
    const gate = new Platform({} as ExecutionContext, environment);
    expect(await gate.spendGate(early.org)).toBe("ok");
    expect(attached()).toEqual([]);
  });

  it("refuses cases and model use once cards are required, until the organization starts a plan", async () => {
    const env = requiredFrom(new Date(Date.now() - 60_000));
    const late = await organizationWithAgent("Late", env);
    stubAutumn();
    customer = { subscriptions: [], flags: {}, balances: {} };
    const refused = await late.keyed.call<{ error: { code: string } }>(
      `/v1/orgs/${late.org}/cases`,
      { body: { agent: "invoices", text: "before a plan" } },
    );
    expect(refused.status).toBe(402);
    expect(refused.body.error.code).toBe("plan_required");
    const gate = new Platform({} as ExecutionContext, env);
    expect(await gate.spendGate(late.org)).toBe("credit_exhausted");
    const billing = await late.keyed.call<{ required: boolean }>(
      `/v1/orgs/${late.org}/billing`,
    );
    expect(billing.body).toMatchObject({ started: false, required: true });
    expect(attached()).toEqual([]);

    customer.subscriptions = [{ plan_id: "free", status: "active" }];
    customer.balances = { model_credit: balance(500) };
    const created = await late.keyed.call(`/v1/orgs/${late.org}/cases`, {
      body: { agent: "invoices", text: "after checkout" },
    });
    expect(created.status).toBe(202);
  });

  it("puts organizations created before cards were required on Free, without a card", async () => {
    const env = requiredFrom(new Date(Date.now() + 86_400_000));
    const existing = await organizationWithAgent("Existing", env);
    stubAutumn();
    customer = { subscriptions: [], flags: {}, balances: {} };
    const plan = await getPlan(env, orgId(existing.org));
    expect(plan.name).toBe("free");
    expect(attached()).toEqual(["free"]);
  });

  it("bills an organization named in BILLING_ENFORCED_ORGS like a customer now, and no other", async () => {
    const enforcedEnv = (org: string) =>
      testEnv({
        AUTUMN_SECRET_KEY: "am_sk_test_stub",
        BILLING_ENFORCED_ORGS: `org_other, ${org}`,
        CASES: { send: () => Promise.resolve() } as unknown as Queue,
      });
    const tester = await organizationWithAgent("Tester");
    const other = await organizationWithAgent("Other");
    const env = enforcedEnv(tester.org);
    const keyed = new Client(env, tester.keyed.headers);
    stubAutumn();
    customer = { subscriptions: [], flags: {}, balances: {} };

    const refused = await keyed.call<{ error: { code: string } }>(
      `/v1/orgs/${tester.org}/cases`,
      { body: { agent: "invoices", text: "before a plan" } },
    );
    expect(refused.status).toBe(402);
    expect(refused.body.error.code).toBe("plan_required");
    const billing = await keyed.call<{ required: boolean }>(
      `/v1/orgs/${tester.org}/billing`,
    );
    expect(billing.body).toMatchObject({ started: false, required: true });
    expect(planRequired(env, orgId(other.org), false)).toBe(false);
    expect(seatLimitApplies(env, orgId(tester.org))).toBe(true);
    expect(seatLimitApplies(env, orgId(other.org))).toBe(false);
    expect(attached()).toEqual([]);
  });

  it("puts our own organizations on the internal plan", async () => {
    const ours = await organizationWithAgent("Ours");
    stubAutumn();
    customer = {
      subscriptions: [],
      flags: {
        sso: {},
        scim: {},
        synced_groups: {},
        custom_roles: {},
        audit_export: {},
      },
      balances: {},
    };
    const env = testEnv({
      AUTUMN_SECRET_KEY: "am_sk_test_stub",
      BILLING_INTERNAL_ORGS: `org_other, ${ours.org}`,
    });
    const plan = await getPlan(env, orgId(ours.org));
    expect(plan.name).toBe("internal");
    expect(plan.features).toHaveLength(5);
    expect(attached()).toEqual(["internal"]);
  });

  it("never limits our own organizations, whatever Autumn's check says", async () => {
    const ours = await organizationWithAgent("Unlimited");
    stubAutumn();
    allowed = false;
    customer = {
      subscriptions: [{ plan_id: "internal", status: "active" }],
      flags: {},
      balances: {},
    };
    const env = testEnv({
      AUTUMN_SECRET_KEY: "am_sk_test_stub",
      BILLING_INTERNAL_ORGS: ours.org,
    });
    expect(await entitlement(env, orgId(ours.org), "cases")).toBe("ok");
    expect(await creditStop(env, orgId(ours.org))).toBe("ok");
    expect(calls.filter((c) => c.route === "check")).toEqual([]);
  });
});

describe("checkout", () => {
  it("lets only the Owner start a plan, after adding a card, and returns to this app", async () => {
    const env = testEnv({
      AUTUMN_SECRET_KEY: "am_sk_test_stub",
      APP_URL: "https://app.example.test",
    });
    const shop = await organizationWithAgent("Shop", env);
    stubAutumn();
    customer = { subscriptions: [], flags: {}, balances: {} };
    const path = `/v1/orgs/${shop.org}/billing/checkout`;
    const started = await shop.owner.call<{ url: string }>(path, {
      body: { plan: "free", returnTo: "https://app.example.test/cases" },
    });
    expect(started.status).toBe(200);
    expect(started.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(
      calls.find((c) => c.route === "billing.setup_payment")?.body,
    ).toEqual({
      customer_id: shop.org,
      plan_id: "free",
      success_url: "https://app.example.test/cases",
    });
    const elsewhere = await shop.owner.call(path, {
      body: { plan: "free", returnTo: "https://evil.example/" },
    });
    expect(elsewhere.status).toBe(400);
    const byKey = await shop.keyed.call(path, { body: { plan: "free" } });
    expect(byKey.status).toBe(403);
    customer.subscriptions = [{ plan_id: "free", status: "active" }];
    const again = await shop.owner.call(path, { body: { plan: "free" } });
    expect(again.status).toBe(409);
  });
});

describe("Free's seats", () => {
  it("hold Free to its included seats once billing is enforced, never before and never for our own organizations", async () => {
    const owner = await signUp("Seat Owner", environment);
    const id = await createOrganization(owner.client, "Seatco");
    const first = await addMember(owner.client, id, "Seat One");
    const second = await addMember(owner.client, id, "Seat Two");
    const third = await addMember(owner.client, id, "Seat Three");
    const groups = await owner.client.call<
      { id: string; isDevelopers: boolean }[]
    >(`/v1/orgs/${id}/groups`);
    const developers = groups.body.find((g) => g.isDevelopers)!.id;
    const join = (env: Env, userId: string) => {
      const client = new Client(env);
      client.cookie = owner.client.cookie;
      return client.call<{ error?: { code: string; message: string } }>(
        `/v1/orgs/${id}/groups/${developers}/members/${userId}`,
        { method: "PUT" },
      );
    };
    stubAutumn();
    customer = {
      subscriptions: [{ plan_id: "free", status: "active" }],
      flags: {},
      balances: {
        seats: { granted: 1, remaining: 1, usage: 0, unlimited: false },
      },
    };
    const enforced = testEnv({
      AUTUMN_SECRET_KEY: "am_sk_test_stub",
      BILLING_REQUIRED_FROM: new Date(Date.now() - 60_000).toISOString(),
    });

    expect((await join(environment, first.userId)).status).toBe(204);
    expect((await join(environment, second.userId)).status).toBe(204);
    const ours = testEnv({
      AUTUMN_SECRET_KEY: "am_sk_test_stub",
      BILLING_REQUIRED_FROM: new Date(Date.now() - 60_000).toISOString(),
      BILLING_INTERNAL_ORGS: id,
    });
    expect((await getPlan(ours, orgId(id))).limits.seats).toBeNull();

    const refused = await join(enforced, third.userId);
    expect(refused.status).toBe(402);
    expect(refused.body.error).toEqual({
      code: "seat_limit_reached",
      message:
        "This would make 3 developer and operator seats, and the free plan includes 1. Free a seat or upgrade first.",
    });
  });
});

describe("credits", () => {
  it("stop new cases and metered calls on Free and Team once none are left, whatever Autumn's check says", async () => {
    const empty = await organizationWithAgent("Emptyco");
    const funded = await organizationWithAgent("Fundedco");
    const committed = await organizationWithAgent("Commitco");
    stubAutumn();
    customer = {
      subscriptions: [{ plan_id: "team", status: "active" }],
      flags: {},
      balances: { model_credit: balance(0, 2_500, 2_700) },
    };
    const refused = await empty.keyed.call<{
      error: { code: string; message: string };
    }>(`/v1/orgs/${empty.org}/cases`, {
      body: { agent: "invoices", text: "no credits left" },
    });
    expect(refused.status).toBe(402);
    expect(refused.body.error).toEqual({
      code: "credit_exhausted",
      message:
        "This organization has run out of credits. Its Owner can buy more in Billing.",
    });
    const gate = new Platform({} as ExecutionContext, environment);
    expect(await gate.spendGate(empty.org)).toBe("credit_exhausted");

    customer.balances = { model_credit: balance(40) };
    const created = await funded.keyed.call(`/v1/orgs/${funded.org}/cases`, {
      body: { agent: "invoices", text: "with credits" },
    });
    expect(created.status).toBe(202);
    expect(await gate.spendGate(funded.org)).toBe("ok");

    customer = {
      subscriptions: [{ plan_id: "enterprise", status: "active" }],
      flags: {},
      balances: {},
    };
    expect(await gate.spendGate(committed.org)).toBe("ok");
  });

  it("charge a case fee past the month's first 1,000 cases, reported as credits and counted as spend", async () => {
    expect(
      [1, 1_000, 1_001, 10_000, 10_001, 100_000, 100_001].map(caseFeeMicroUsd),
    ).toEqual([0, 0, 20_000, 20_000, 10_000, 10_000, 5_000]);
    const busy = await organizationWithAgent("Busyco");
    stubAutumn();
    customer = {
      subscriptions: [{ plan_id: "team", status: "active" }],
      flags: {},
      balances: { model_credit: balance(10_000) },
    };
    await withOrg(environment, orgId(busy.org), (tx) =>
      tx.insert(usageRecords).values(
        Array.from({ length: 1_000 }, () => ({
          id: newId("usageRecord"),
          organizationId: busy.org,
          feature: "cases" as const,
          quantity: 1,
          reportedAt: new Date(),
        })),
      ),
    );
    const created = await busy.keyed.call(`/v1/orgs/${busy.org}/cases`, {
      body: { agent: "invoices", text: "the 1,001st" },
    });
    expect(created.status).toBe(202);
    const fees = await withOrg(environment, orgId(busy.org), (tx) =>
      tx
        .select({ quantity: usageRecords.quantity })
        .from(usageRecords)
        .where(eq(usageRecords.feature, "case_fees")),
    );
    expect(fees).toEqual([{ quantity: 20_000 }]);
    expect(
      (await withOrg(environment, orgId(busy.org), (tx) => monthSpendParts(tx)))
        .caseFees,
    ).toBe(20_000);

    await reportUsage(environment);
    const reported = await withOrg(environment, orgId(busy.org), (tx) =>
      tx
        .select({
          quantity: usageReports.quantity,
          remainder: usageReports.remainder,
        })
        .from(usageReports)
        .where(eq(usageReports.feature, "case_fee_credits")),
    );
    expect(reported).toEqual([{ quantity: 2, remainder: 0 }]);
  });
});

describe("billing routes", () => {
  const env = testEnv({
    AUTUMN_SECRET_KEY: "am_sk_test_stub",
    APP_URL: "https://app.example.test",
    CASES: { send: () => Promise.resolve() } as unknown as Queue,
  });
  const team = () => ({
    subscriptions: [{ plan_id: "team", status: "active" }],
    flags: {},
    balances: { model_credit: balance(0) },
  });

  it("show the credits, what is owed, auto-reload, and the card to the Owner alone", async () => {
    const shop = await organizationWithAgent("Balanceco", env);
    stubAutumn();
    customer = {
      ...team(),
      balances: { model_credit: balance(0, 2_500, 2_700) },
      billing_controls: {
        auto_topups: [
          {
            feature_id: "model_credit",
            enabled: true,
            threshold: 500,
            quantity: 2_000,
            purchase_limit: {
              limit_type: "amount",
              interval: "month",
              limit: 200,
            },
          },
        ],
      },
      payment_method: { card: { brand: "visa", last4: "4242" } },
    };
    const path = `/v1/orgs/${shop.org}/billing`;
    const owner = await shop.owner.call(path);
    expect(owner.body).toMatchObject({
      plan: "team",
      credits: { remaining: 0, owed: 200 },
      autoReload: {
        enabled: true,
        belowCredits: 500,
        addCredits: 2_000,
        monthlyLimitUsd: 200,
      },
      card: { brand: "visa", last4: "4242" },
    });
    expect(
      calls.filter((c) => c.body.expand).map((c) => c.body.expand),
    ).toEqual([["payment_method"]]);
    const byKey = await shop.keyed.call(path);
    expect(byKey.body).toMatchObject({ credits: { remaining: 0 }, card: null });
  });

  it("let the Owner buy credits on Free and Team, at least 1,000, charged to the card or finished on Stripe's page", async () => {
    const shop = await organizationWithAgent("Topupco", env);
    const big = await organizationWithAgent("Bigco", env);
    stubAutumn();
    customer = team();
    const path = `/v1/orgs/${shop.org}/billing/credits`;
    expect(
      (await shop.owner.call(path, { body: { credits: 999 } })).status,
    ).toBe(400);
    expect(
      (await shop.keyed.call(path, { body: { credits: 2_000 } })).status,
    ).toBe(403);
    const bought = await shop.owner.call(path, {
      body: { credits: 2_000, returnTo: "https://app.example.test/billing" },
    });
    expect(bought.status).toBe(200);
    expect(bought.body).toEqual({ url: null });
    expect(calls.find((c) => c.route === "billing.attach")?.body).toEqual({
      customer_id: shop.org,
      plan_id: "credits",
      feature_quantities: [{ feature_id: "model_credit", quantity: 2_000 }],
      success_url: "https://app.example.test/billing",
    });
    paymentUrl = "https://invoice.stripe.com/i/test";
    const authenticate = await shop.owner.call(path, {
      body: { credits: 1_000 },
    });
    expect(authenticate.body).toEqual({ url: paymentUrl });

    customer = {
      subscriptions: [{ plan_id: "enterprise", status: "active" }],
      flags: {},
      balances: {},
    };
    const refused = await big.owner.call(
      `/v1/orgs/${big.org}/billing/credits`,
      {
        body: { credits: 2_000 },
      },
    );
    expect(refused.status).toBe(409);
  });

  it("set auto-reload, capped each month at the spending limit unless the Owner names a cap", async () => {
    const shop = await organizationWithAgent("Reloadco", env);
    stubAutumn();
    customer = team();
    await shop.owner.call(`/v1/orgs/${shop.org}/spending/limit`, {
      method: "PUT",
      body: { limitUsd: 150 },
    });
    const path = `/v1/orgs/${shop.org}/billing/auto-reload`;
    const set = await shop.owner.call(path, {
      method: "PUT",
      body: { enabled: true, belowCredits: 500, addCredits: 2_000 },
    });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({
      enabled: true,
      belowCredits: 500,
      addCredits: 2_000,
      monthlyLimitUsd: 150,
    });
    expect(calls.find((c) => c.route === "customers.update")?.body).toEqual({
      customer_id: shop.org,
      billing_controls: {
        auto_topups: [
          {
            feature_id: "model_credit",
            enabled: true,
            threshold: 500,
            quantity: 2_000,
            purchase_limit: {
              limit_type: "amount",
              interval: "month",
              limit: 150,
            },
          },
        ],
      },
    });
    const uncapped = await shop.owner.call(path, {
      method: "PUT",
      body: {
        enabled: true,
        belowCredits: 500,
        addCredits: 2_000,
        monthlyLimitUsd: null,
      },
    });
    expect(uncapped.body).toMatchObject({ monthlyLimitUsd: null });
    expect(
      (
        await shop.owner.call(path, {
          method: "PUT",
          body: { enabled: true, belowCredits: 500, addCredits: 500 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await shop.keyed.call(path, {
          method: "PUT",
          body: { enabled: false, belowCredits: 0, addCredits: 1_000 },
        })
      ).status,
    ).toBe(403);
  });

  it("preview a plan change, then make it once a plan is started", async () => {
    const shop = await organizationWithAgent("Upgradeco", env);
    const fresh = await organizationWithAgent("Freshco", env);
    stubAutumn();
    customer = {
      subscriptions: [{ plan_id: "free", status: "active" }],
      flags: {},
      balances: { model_credit: balance(500) },
    };
    const preview = await shop.owner.call(
      `/v1/orgs/${shop.org}/billing/plan/preview`,
      { body: { plan: "team" } },
    );
    expect(preview.body).toEqual({
      totalUsd: 0,
      lines: [{ description: "Team - Active seats", totalUsd: 0 }],
      nextInvoice: { at: "2026-12-01T00:00:00.000Z", totalUsd: 16 },
    });
    const path = `/v1/orgs/${shop.org}/billing/plan`;
    const changed = await shop.owner.call(path, { body: { plan: "team" } });
    expect(changed.status).toBe(200);
    expect(changed.body).toEqual({ url: null });
    expect(calls.find((c) => c.route === "billing.attach")?.body).toEqual({
      customer_id: shop.org,
      plan_id: "team",
      success_url: "https://app.example.test/",
    });
    expect(
      (await shop.owner.call(path, { body: { plan: "team" } })).status,
    ).toBe(409);

    customer = { subscriptions: [], flags: {}, balances: {} };
    expect(
      (
        await fresh.owner.call(`/v1/orgs/${fresh.org}/billing/plan`, {
          body: { plan: "team" },
        })
      ).status,
    ).toBe(409);
  });
});
