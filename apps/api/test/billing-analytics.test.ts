// Billing's product analytics (PRE-160): each event reaches the queue once
// its action has committed or Autumn has taken it, never for a refused or
// rolled-back request, and Autumn's auto-reload webhook sends events only
// after its Svix signature checks out and the record is written. Autumn's API
// is stubbed; nothing here leaves the test.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env.ts";
import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
  tracked,
} from "./helpers.ts";

const SECRET = "whsec_" + btoa("billing-analytics-signing-secret");

const env: Env = testEnv({
  POSTHOG_KEY: "phc_test",
  AUTUMN_SECRET_KEY: "am_sk_test_stub",
  AUTUMN_WEBHOOK_SECRET: SECRET,
  APP_URL: "https://app.example.test",
});

let customer: Record<string, unknown> = {};
let paymentUrl: string | null = null;
let failUpdate = false;

const stubAutumn = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.useautumn.com")
      throw new Error("unexpected fetch to " + url.hostname);
    const route = url.pathname.replace("/v1/", "");
    const body = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    ) as Record<string, unknown>;
    const json = (value: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(value), {
          headers: { "content-type": "application/json" },
        }),
      );
    if (route === "customers.get_or_create")
      return json({ id: body.customer_id, ...customer });
    if (route === "customers.update") {
      customer.billing_controls = body.billing_controls;
      return json({ id: body.customer_id, ...customer });
    }
    if (route === "billing.setup_payment")
      return json({ url: "https://checkout.example.test/cs_test" });
    if (route === "billing.attach" || route === "billing.multi_attach")
      return json({ payment_url: paymentUrl });
    if (route === "billing.update")
      return failUpdate
        ? Promise.resolve(new Response("{}", { status: 500 }))
        : json({ payment_url: null });
    return json({});
  });

const team = () => ({
  subscriptions: [{ plan_id: "team", status: "active" }],
  flags: {},
  balances: {
    model_credit: { granted: 0, remaining: 0, usage: 0, unlimited: false },
  },
  payment_method: { card: { brand: "visa", last4: "4242" } },
});

afterEach(() => {
  vi.restoreAllMocks();
  customer = {};
  paymentUrl = null;
  failUpdate = false;
});

const organization = async (name: string) => {
  const owner = await signUp(name, env);
  const org = await createOrganization(owner.client, name);
  return { org, owner };
};

// The organization's events since start, group updates aside.
const eventsOf = (org: string, start: number) =>
  tracked
    .slice(start)
    .filter((e) => e.event !== "$groupidentify")
    .filter((e) => e.properties.organization_id === org);

const sign = async (
  id: string,
  timestamp: string,
  body: string,
  secret: string,
) => {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret.slice("whsec_".length)), (c) =>
      c.charCodeAt(0),
    ),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode([id, timestamp, body].join(".")),
    ),
  );
  return "v1," + btoa(String.fromCharCode(...mac));
};

const deliver = async (
  payload: unknown,
  {
    environment = env,
    secret = SECRET,
    at = Date.now(),
    headers,
  }: {
    environment?: Env;
    secret?: string;
    at?: number;
    headers?: Record<string, string>;
  } = {},
) => {
  const body = JSON.stringify(payload);
  const id = "msg_" + crypto.randomUUID();
  const timestamp = String(Math.floor(at / 1000));
  return new Client(
    environment,
    headers ?? {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": await sign(id, timestamp, body, secret),
    },
  ).call("/v1/autumn/webhook", { method: "POST", body: payload });
};

const succeeded = (org: string) => ({
  type: "billing.auto_topup_succeeded",
  id: "evt_" + crypto.randomUUID(),
  occurred_at: Date.now(),
  data: {
    customer_id: org,
    feature_id: "model_credit",
    quantity_granted: 10_000,
  },
});

const failed = (
  org: string,
  reason: string,
  error: Record<string, unknown> | null = null,
) => ({
  type: "billing.auto_topup_failed",
  id: "evt_" + crypto.randomUUID(),
  occurred_at: Date.now(),
  data: {
    customer_id: org,
    feature_id: "model_credit",
    reason,
    quantity: 2_000,
    threshold: 500,
    balance: 120,
    error,
  },
});

const DECLINED = { code: "card_declined", decline_code: "generic_decline" };

describe("the auto-reload webhook's events", () => {
  it("sends nothing for a missing, wrong or stale signature", async () => {
    const shop = await organization("Badsigco");
    const start = tracked.length;
    const event = succeeded(shop.org);
    expect((await deliver(event, { headers: {} })).status).toBe(401);
    expect(
      (await deliver(event, { secret: "whsec_" + btoa("not-the-secret") }))
        .status,
    ).toBe(401);
    expect(
      (await deliver(event, { at: Date.now() - 10 * 60_000 })).status,
    ).toBe(401);
    expect(
      (
        await deliver(failed(shop.org, "charge_failed", DECLINED), {
          secret: "whsec_" + btoa("not-the-secret"),
        })
      ).status,
    ).toBe(401);
    expect(eventsOf(shop.org, start)).toEqual([]);
  });

  it("sends one auto-reload top-up for a signed success, from nobody, in credits", async () => {
    const shop = await organization("Goodsigco");
    const start = tracked.length;
    expect((await deliver(succeeded(shop.org))).status).toBe(204);
    const events = eventsOf(shop.org, start);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "credits_topped_up",
      distinctId: shop.org,
      properties: {
        credits: 10_000,
        credits_bucket: "gt_10k",
        source: "auto_reload",
        $groups: { organization: shop.org },
      },
    });
  });

  it("sends one failure for each recorded failed reload, by cause", async () => {
    const shop = await organization("Failsigco");
    const start = tracked.length;
    await deliver(failed(shop.org, "charge_failed", DECLINED));
    await deliver(failed(shop.org, "missing_payment_method"));
    await deliver(failed(shop.org, "purchase_limit_reached"));
    const events = eventsOf(shop.org, start);
    expect(events.map((e) => [e.event, e.properties.cause])).toEqual([
      ["auto_reload_failed", "card_declined"],
      ["auto_reload_failed", "card"],
      ["auto_reload_failed", "monthly_cap"],
    ]);
    expect(events[0]?.properties).toMatchObject({
      credits: 2_000,
      credits_bucket: "n1k_to_10k",
    });
    expect(JSON.stringify(events)).not.toContain("generic_decline");
  });

  it("sends nothing for a reason it doesn't record, a customer that isn't ours, or without a PostHog key", async () => {
    const shop = await organization("Quietsigco");
    const start = tracked.length;
    expect((await deliver(failed(shop.org, "lock_contention"))).status).toBe(
      204,
    );
    expect(
      (await deliver(succeeded("org_01m8g4sjmtesmbxhkbpn9yyzzz"))).status,
    ).toBe(204);
    const keyless = testEnv({
      AUTUMN_SECRET_KEY: "am_sk_test_stub",
      AUTUMN_WEBHOOK_SECRET: SECRET,
    });
    expect(
      (await deliver(succeeded(shop.org), { environment: keyless })).status,
    ).toBe(204);
    expect(
      tracked.slice(start).filter((e) => e.event !== "$groupidentify"),
    ).toEqual([]);
  });
});

describe("billing route events", () => {
  it("send a purchase top-up only once the card on file is charged", async () => {
    const shop = await organization("Buyco");
    stubAutumn();
    customer = team();
    const path = "/v1/orgs/" + shop.org + "/billing/credits";
    const start = tracked.length;
    paymentUrl = "https://checkout.example.test/pay";
    await shop.owner.client.call(path, { body: { credits: 5_000 } });
    expect(eventsOf(shop.org, start)).toEqual([]);
    paymentUrl = null;
    await shop.owner.client.call(path, { body: { credits: 5_000 } });
    expect(eventsOf(shop.org, start)).toMatchObject([
      {
        event: "credits_topped_up",
        distinctId: shop.owner.userId,
        properties: {
          credits: 5_000,
          credits_bucket: "n1k_to_10k",
          source: "purchase",
        },
      },
    ]);
  });

  it("send checkout_started for the Owner's checkout and nothing for a refused one", async () => {
    const shop = await organization("Checkco");
    const member = await addMember(shop.owner.client, shop.org, "Checker");
    env.BILLING_ENFORCED_ORGS = shop.org;
    stubAutumn();
    customer = { subscriptions: [], flags: {}, balances: {} };
    const path = "/v1/orgs/" + shop.org + "/billing/checkout";
    const start = tracked.length;
    try {
      expect(
        (await member.client.call(path, { body: { plan: "free" } })).status,
      ).toBe(403);
      expect(eventsOf(shop.org, start)).toEqual([]);
      await shop.owner.client.call(path, { body: { plan: "free" } });
      paymentUrl = "https://checkout.example.test/team";
      await shop.owner.client.call(path, {
        body: { plan: "team", credits: 2_500 },
      });
    } finally {
      delete env.BILLING_ENFORCED_ORGS;
    }
    expect(
      eventsOf(shop.org, start).map((e) => [e.event, e.properties]),
    ).toMatchObject([
      [
        "checkout_started",
        { plan: "free", credits: 0, credits_bucket: "zero", paid: false },
      ],
      [
        "checkout_started",
        {
          plan: "team",
          credits: 2_500,
          credits_bucket: "n1k_to_10k",
          paid: false,
        },
      ],
    ]);
  });

  it("send auto_reload_changed with the saved settings, never for a refused change", async () => {
    const shop = await organization("Reloadeventco");
    const member = await addMember(shop.owner.client, shop.org, "Reloader");
    stubAutumn();
    customer = team();
    const path = "/v1/orgs/" + shop.org + "/billing/auto-reload";
    const start = tracked.length;
    const body = { enabled: true, belowCredits: 500, addCredits: 2_000 };
    expect(
      (await member.client.call(path, { method: "PUT", body })).status,
    ).toBe(403);
    expect(eventsOf(shop.org, start)).toEqual([]);
    await shop.owner.client.call(path, {
      method: "PUT",
      body: { ...body, monthlyLimitUsd: 200 },
    });
    expect(eventsOf(shop.org, start)).toMatchObject([
      {
        event: "auto_reload_changed",
        properties: {
          enabled: true,
          below_credits: 500,
          add_credits: 2_000,
          add_bucket: "n1k_to_10k",
          monthly_cap: true,
        },
      },
    ]);
  });

  it("send a retried reload as a retry top-up once it is charged", async () => {
    const shop = await organization("Retryeventco");
    stubAutumn();
    customer = {
      ...team(),
      billing_controls: {
        auto_topups: [
          {
            feature_id: "model_credit",
            enabled: true,
            threshold: 500,
            quantity: 2_000,
          },
        ],
      },
    };
    const start = tracked.length;
    await shop.owner.client.call(
      "/v1/orgs/" + shop.org + "/billing/auto-reload/retry",
      { body: {} },
    );
    expect(eventsOf(shop.org, start)).toMatchObject([
      {
        event: "credits_topped_up",
        properties: { credits: 2_000, source: "retry" },
      },
    ]);
  });

  it("send spending_limit_set once per change, in credits, and not for a refused or unchanged one", async () => {
    const shop = await organization("Limitco");
    const member = await addMember(shop.owner.client, shop.org, "Limiter");
    const path = "/v1/orgs/" + shop.org + "/spending/limit";
    const put = (client: Client, limitUsd: number | null) =>
      client.call(path, { method: "PUT", body: { limitUsd } });
    const start = tracked.length;
    expect((await put(member.client, 10)).status).toBe(403);
    await put(shop.owner.client, 150);
    await put(shop.owner.client, 150);
    await put(shop.owner.client, null);
    expect(
      eventsOf(shop.org, start).map((e) => [e.event, e.properties]),
    ).toMatchObject([
      [
        "spending_limit_set",
        {
          limit: true,
          limit_credits: 15_000,
          limit_bucket: "gt_10k",
          loosened: false,
          via: "settings",
        },
      ],
      [
        "spending_limit_set",
        { limit: false, limit_credits: 0, loosened: true, via: "settings" },
      ],
    ]);
  });

  it("send spending_limit_set when an approved request changes the limit, and not for a rejected one", async () => {
    const shop = await organization("Requestlimitco");
    const base = "/v1/orgs/" + shop.org + "/guardrail-requests";
    const file = async (limitUsd: number) =>
      (
        await shop.owner.client.call<{ id: string }>(base, {
          body: { change: { kind: "spending_limit", limitUsd } },
        })
      ).body.id;
    const rejected = await file(50);
    const approved = await file(80);
    const start = tracked.length;
    expect(
      (
        await shop.owner.client.call(base + "/" + rejected + "/reject", {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(eventsOf(shop.org, start)).toEqual([]);
    expect(
      (
        await shop.owner.client.call(base + "/" + approved + "/approve", {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(eventsOf(shop.org, start)).toMatchObject([
      {
        event: "spending_limit_set",
        distinctId: shop.owner.userId,
        properties: {
          limit: true,
          limit_credits: 8_000,
          limit_bucket: "n1k_to_10k",
          loosened: false,
          via: "request",
        },
      },
    ]);
  });

  it("send plan_cancel_started for the move-to-Free preview and plan_cancel_withdrawn for keeping Team", async () => {
    const shop = await organization("Cancelco");
    stubAutumn();
    customer = team();
    const start = tracked.length;
    expect(
      (
        await shop.owner.client.call(
          "/v1/orgs/" + shop.org + "/billing/plan/change/preview",
        )
      ).status,
    ).toBe(200);
    customer = {
      ...team(),
      subscriptions: [
        { plan_id: "team", status: "active" },
        { plan_id: "free", status: "scheduled", started_at: Date.now() + 1e9 },
      ],
    };
    expect(
      (
        await shop.owner.client.call(
          "/v1/orgs/" + shop.org + "/billing/plan/change",
          { method: "DELETE" },
        )
      ).status,
    ).toBe(204);
    expect(
      eventsOf(shop.org, start).map((e) => [e.event, e.properties]),
    ).toMatchObject([
      ["plan_cancel_started", { seats_over: 0, agents_paused: 0 }],
      ["plan_cancel_withdrawn", { plan: "team", instead: "free" }],
    ]);
  });

  it("send org_deleted once the deletion commits, and nothing when it is rolled back", async () => {
    const shop = await organization("Deleteco");
    stubAutumn();
    customer = team();
    const deleting = () =>
      shop.owner.client.call("/api/auth/organization/delete", {
        body: { organizationId: shop.org },
      });
    const start = tracked.length;
    failUpdate = true;
    expect((await deleting()).status).toBe(503);
    expect(eventsOf(shop.org, start)).toEqual([]);
    failUpdate = false;
    expect((await deleting()).status).toBe(200);
    expect(eventsOf(shop.org, start)).toMatchObject([
      { event: "org_deleted", distinctId: shop.owner.userId },
    ]);
  });
});
