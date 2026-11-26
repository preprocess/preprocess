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

import { activeSeats, readPlan, reportUsage } from "../src/billing.ts";
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
const organizationWithAgent = async (name: string) => {
  const owner = await signUp(name, environment);
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
    keyed: new Client(environment, { "x-api-key": key.body.key }),
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

  it("refuse cases and model use before the organization starts a plan", async () => {
    const fresh = await organizationWithAgent("Fresh");
    stubAutumn();
    customer = { subscriptions: [], flags: {}, balances: {} };
    allowed = true;
    const refused = await fresh.keyed.call<{ error: { code: string } }>(
      `/v1/orgs/${fresh.org}/cases`,
      { body: { agent: "invoices", text: "before a plan" } },
    );
    expect(refused.status).toBe(402);
    expect(refused.body.error.code).toBe("plan_required");
    const gate = new Platform({} as ExecutionContext, environment);
    expect(await gate.spendGate(fresh.org)).toBe("credit_exhausted");
    expect(calls.some((c) => c.route === "check")).toBe(false);
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
