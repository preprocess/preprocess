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
import { seatActivity, usageRecords } from "@preprocess/db/schema/billing";
import { deployments } from "@preprocess/db/schema/deployments";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  activeSeats,
  planRequired,
  readPlan,
  reportUsage,
  seatLimitApplies,
} from "../src/billing.ts";
import type { Env } from "../src/env.ts";
import { monthOf } from "../src/metering.ts";
import { getPlan } from "../src/plan.ts";
import { Platform } from "../src/platform.ts";
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
};
let allowed = true;

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
});

describe("reporting usage", () => {
  it("sends each unreported record once, under its id, and never log bytes", async () => {
    stubAutumn();
    customer = { subscriptions: [], flags: {}, balances: {} };
    const ids = [newId("usageRecord"), newId("usageRecord")];
    await withOrg(environment, orgId(org), (tx) =>
      tx.insert(usageRecords).values([
        { id: ids[0]!, organizationId: org, feature: "cases", quantity: 1 },
        {
          id: ids[1]!,
          organizationId: org,
          feature: "model_usage",
          quantity: 4_200,
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
    const tracked = calls.filter((c) => c.route === "track");
    expect(
      tracked
        .filter((c) => c.body.customer_id === org)
        .map((c) => [c.key, c.body.feature_id, c.body.value]),
    ).toEqual([
      [ids[0], "cases", 1],
      [ids[1], "model_usage", 4_200],
    ]);
    calls = [];
    await reportUsage(environment);
    expect(
      calls.filter((c) => c.route === "track" && c.body.customer_id === org),
    ).toEqual([]);
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

  it("is free and unlimited where billing is off", async () => {
    const plan = await getPlan(testEnv(), orgId(org));
    expect(plan).toMatchObject({ name: "free", limits: { seats: null } });
  });
});

describe("Free's caps", () => {
  it("refuse a new case once the month's cases are used, and halt model calls once the credit is", async () => {
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
    ).toEqual(["cases", "model_usage"]);
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
