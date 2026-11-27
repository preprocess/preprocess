// Auto-reload's "last reload failed" and "monthly cap reached" states
// (PRE-128): Autumn's signed webhook records them per organization, GET
// /billing shows them to Owners and Admins, and a successful Retry, top-up or
// auto top-up, or the balance back at the threshold, clears a failure. Autumn's
// API is stubbed; nothing here leaves the test.

import { withOrg, orgId } from "@preprocess/db/client";
import { auditEvents } from "@preprocess/db/schema/audit";
import { autoReloadStates } from "@preprocess/db/schema/billing";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { verifySvix } from "../src/auto-reload.ts";
import type { Env } from "../src/env.ts";
import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";

type Call = { route: string; body: Record<string, unknown> };
let calls: Call[] = [];
let customer: Record<string, unknown> = {};
let attached: Record<string, unknown> = { payment_url: null };

const stubAutumn = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.useautumn.com")
      throw new Error("unexpected fetch to " + url.hostname);
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
    if (route === "customers.get_or_create")
      return json({ id: body.customer_id, ...customer });
    if (route === "billing.attach") return json(attached);
    return json({});
  });

const SECRET = "whsec_" + btoa("auto-reload-test-signing-secret!");

const env: Env = testEnv({
  AUTUMN_SECRET_KEY: "am_sk_test_stub",
  AUTUMN_WEBHOOK_SECRET: SECRET,
  APP_URL: "https://app.example.test",
});

const visa = {
  card: { brand: "visa", last4: "4242", exp_month: 8, exp_year: 2028 },
};

// Team with auto-reload on: below $25, add $100, up to $500 a month.
const team = (remaining: number) => ({
  subscriptions: [{ plan_id: "team", status: "active" }],
  flags: {},
  balances: {
    model_credit: { granted: remaining, remaining, usage: 0, unlimited: false },
  },
  payment_method: visa,
  billing_controls: {
    auto_topups: [
      {
        feature_id: "model_credit",
        enabled: true,
        threshold: 2_500,
        quantity: 10_000,
        purchase_limit: { limit_type: "amount", interval: "month", limit: 500 },
      },
    ],
  },
});

const organization = async (name: string) => {
  const owner = await signUp(name, env);
  const org = await createOrganization(owner.client, name);
  const admin = await addMember(owner.client, org, name + " Admin", "admin");
  const member = await addMember(owner.client, org, name + " Member");
  return { org, owner, admin, member };
};

const sign = async (
  id: string,
  timestamp: string,
  body: string,
  secret = SECRET,
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

const failed = (
  org: string,
  reason: string,
  error: Record<string, unknown> | null = null,
  occurredAt = Date.now(),
) => ({
  type: "billing.auto_topup_failed",
  id: "evt_" + crypto.randomUUID(),
  occurred_at: occurredAt,
  data: {
    customer_id: org,
    feature_id: "model_credit",
    reason,
    quantity: 10_000,
    threshold: 2_500,
    balance: 412,
    invoice_mode: false,
    error,
  },
});

const DECLINED = {
  code: "card_declined",
  message: "Your card was declined.",
  type: "card_error",
  decline_code: "generic_decline",
};

type ReloadBody = {
  autoReload: {
    failed: { at: string; reason: string | null } | null;
    capReachedUntil: string | null;
  } | null;
};

const read = (client: Client, org: string) =>
  client.call<ReloadBody>("/v1/orgs/" + org + "/billing");

const nextMonth = (at = new Date()) =>
  new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1),
  ).toISOString();

afterEach(() => {
  vi.restoreAllMocks();
  calls = [];
  attached = { payment_url: null };
});

describe("Autumn webhook signature", () => {
  it("rejects a missing, wrong or stale signature and records nothing", async () => {
    const shop = await organization("Sigco");
    const event = failed(shop.org, "charge_failed", DECLINED);
    expect((await deliver(event, { headers: {} })).status).toBe(401);
    expect(
      (await deliver(event, { secret: "whsec_" + btoa("not-the-secret") }))
        .status,
    ).toBe(401);
    expect(
      (await deliver(event, { at: Date.now() - 10 * 60_000 })).status,
    ).toBe(401);
    const rows = await withOrg(env, orgId(shop.org), (tx) =>
      tx.select().from(autoReloadStates),
    );
    expect(rows).toEqual([]);
  });

  it("checks a signature against a body that changed after signing", async () => {
    const id = "msg_1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sign(id, timestamp, '{"a":1}');
    const headers = new Headers({
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": "v1,bm90LWl0 " + signature,
    });
    expect(await verifySvix(SECRET, headers, '{"a":1}')).toBe(true);
    expect(await verifySvix(SECRET, headers, '{"a":2}')).toBe(false);
  });

  it("answers 404 without the signing secret or on a self-hosted install", async () => {
    const shop = await organization("Offco");
    const event = failed(shop.org, "charge_failed", DECLINED);
    const unset = testEnv({ AUTUMN_SECRET_KEY: "am_sk_test_stub" });
    expect((await deliver(event, { environment: unset })).status).toBe(404);
    const { PREPROCESS_REGION: _, ...selfHosted } = env;
    expect((await deliver(event, { environment: selfHosted })).status).toBe(
      404,
    );
    const rows = await withOrg(env, orgId(shop.org), (tx) =>
      tx.select().from(autoReloadStates),
    );
    expect(rows).toEqual([]);
  });
});

describe("auto-reload states on GET /billing", () => {
  it("shows a declined reload to Owners and Admins only, and keeps it in its organization", async () => {
    const shop = await organization("Declineco");
    const other = await organization("Bystanderco");
    stubAutumn();
    customer = team(412);
    expect(
      (await deliver(failed(shop.org, "charge_failed", DECLINED))).status,
    ).toBe(204);

    const owner = await read(shop.owner.client, shop.org);
    expect(owner.body.autoReload).toMatchObject({
      enabled: true,
      belowCredits: 2_500,
      failed: { reason: "card_declined" },
      capReachedUntil: null,
    });
    const admin = await read(shop.admin.client, shop.org);
    expect(admin.body.autoReload?.failed?.reason).toBe("card_declined");
    const member = await read(shop.member.client, shop.org);
    expect(member.body.autoReload).toMatchObject({
      failed: null,
      capReachedUntil: null,
    });

    const bystander = await read(other.owner.client, other.org);
    expect(bystander.body.autoReload).toMatchObject({
      failed: null,
      capReachedUntil: null,
    });
    const seen = await withOrg(env, orgId(other.org), (tx) =>
      tx.select().from(autoReloadStates),
    );
    expect(seen).toEqual([]);
  });

  it("maps card failures without a decline to no reason, and ignores other reasons", async () => {
    const shop = await organization("Nocardco");
    const quiet = await organization("Lockco");
    stubAutumn();
    customer = team(412);
    await deliver(failed(shop.org, "missing_payment_method"));
    const owner = await read(shop.owner.client, shop.org);
    expect(owner.body.autoReload?.failed).toMatchObject({ reason: null });

    expect((await deliver(failed(quiet.org, "lock_contention"))).status).toBe(
      204,
    );
    const untouched = await read(quiet.owner.client, quiet.org);
    expect(untouched.body.autoReload).toMatchObject({
      failed: null,
      capReachedUntil: null,
    });
  });

  it("answers 204 for a customer that is no organization of ours", async () => {
    expect(
      (await deliver(failed("org_not_ours", "charge_failed", DECLINED))).status,
    ).toBe(204);
  });

  it("holds the monthly cap until the 1st of next month (UTC)", async () => {
    const shop = await organization("Capco");
    const stale = await organization("Oldcapco");
    stubAutumn();
    customer = team(412);
    await deliver(failed(shop.org, "purchase_limit_reached"));
    const owner = await read(shop.owner.client, shop.org);
    expect(owner.body.autoReload).toMatchObject({
      failed: null,
      capReachedUntil: nextMonth(),
    });

    const now = new Date();
    const lastMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15);
    await deliver(failed(stale.org, "purchase_limit_reached", null, lastMonth));
    const rolledOver = await read(stale.owner.client, stale.org);
    expect(rolledOver.body.autoReload?.capReachedUntil).toBeNull();
  });

  it("clears a failure once the balance is back at the threshold", async () => {
    const shop = await organization("Recoverco");
    stubAutumn();
    customer = team(412);
    await deliver(failed(shop.org, "charge_failed", DECLINED));
    customer = team(2_500);
    const back = await read(shop.owner.client, shop.org);
    expect(back.body.autoReload?.failed).toBeNull();
    customer = team(412);
    const low = await read(shop.owner.client, shop.org);
    expect(low.body.autoReload?.failed).toBeNull();
  });

  it("clears a failure after a top-up on the card on file, not one that still needs paying", async () => {
    const shop = await organization("Topupco");
    stubAutumn();
    customer = team(412);
    await deliver(failed(shop.org, "charge_failed", DECLINED));
    const path = "/v1/orgs/" + shop.org + "/billing/credits";
    attached = {
      payment_url: "https://checkout.stripe.com/c/pay/declined",
      required_action: { code: "payment_failed", reason: "declined" },
    };
    await shop.owner.client.call(path, { body: { credits: 5_000 } });
    expect(
      (await read(shop.owner.client, shop.org)).body.autoReload?.failed,
    ).not.toBeNull();
    attached = { payment_url: null };
    await shop.owner.client.call(path, { body: { credits: 5_000 } });
    expect(
      (await read(shop.owner.client, shop.org)).body.autoReload?.failed,
    ).toBeNull();
  });

  it("clears a failure and the cap when an auto top-up succeeds", async () => {
    const shop = await organization("Succeedco");
    stubAutumn();
    customer = team(412);
    await deliver(failed(shop.org, "charge_failed", DECLINED));
    await deliver(failed(shop.org, "purchase_limit_reached"));
    await deliver({
      type: "billing.auto_topup_succeeded",
      id: "evt_ok",
      occurred_at: Date.now(),
      data: {
        customer_id: shop.org,
        feature_id: "model_credit",
        quantity_granted: 10_000,
      },
    });
    expect(
      (await read(shop.owner.client, shop.org)).body.autoReload,
    ).toMatchObject({ failed: null, capReachedUntil: null });
  });
});

describe("POST /billing/auto-reload/retry", () => {
  it("is the Owner's alone", async () => {
    const shop = await organization("Retryroleco");
    stubAutumn();
    customer = team(412);
    const path = "/v1/orgs/" + shop.org + "/billing/auto-reload/retry";
    expect((await shop.admin.client.call(path, { body: {} })).status).toBe(403);
    expect((await shop.member.client.call(path, { body: {} })).status).toBe(
      403,
    );
    expect(calls.some((c) => c.route === "billing.attach")).toBe(false);
  });

  it("buys the reload's credits on the card on file, clears the failure and audits it", async () => {
    const shop = await organization("Retryco");
    stubAutumn();
    customer = team(412);
    await deliver(failed(shop.org, "charge_failed", DECLINED));
    const path = "/v1/orgs/" + shop.org + "/billing/auto-reload/retry";
    const retried = await shop.owner.client.call(path, { body: {} });
    expect(retried).toMatchObject({
      status: 200,
      body: { url: null, action: null },
    });
    const attach = calls.find((c) => c.route === "billing.attach");
    expect(attach?.body).toMatchObject({
      customer_id: shop.org,
      plan_id: "credits",
      feature_quantities: [{ feature_id: "model_credit", quantity: 10_000 }],
    });
    expect(
      (await read(shop.owner.client, shop.org)).body.autoReload?.failed,
    ).toBeNull();
    const events = await withOrg(env, orgId(shop.org), (tx) =>
      tx
        .select({ data: auditEvents.data })
        .from(auditEvents)
        .where(eq(auditEvents.action, "billing.auto_reload_retried")),
    );
    expect(events).toEqual([{ data: { credits: 10_000, paid: true } }]);
  });

  it("answers what the Owner must do when the card is declined again, and keeps the failure", async () => {
    const shop = await organization("Retrydeclineco");
    stubAutumn();
    customer = team(412);
    await deliver(failed(shop.org, "charge_failed", DECLINED));
    attached = {
      payment_url: "https://checkout.stripe.com/c/pay/declined",
      required_action: { code: "payment_failed", reason: "declined" },
    };
    const path = "/v1/orgs/" + shop.org + "/billing/auto-reload/retry";
    const retried = await shop.owner.client.call(path, { body: {} });
    expect(retried.body).toEqual({
      url: "https://checkout.stripe.com/c/pay/declined",
      action: "card_declined",
    });
    expect(
      (await read(shop.owner.client, shop.org)).body.autoReload?.failed,
    ).not.toBeNull();
  });

  it("refuses without auto-reload set up", async () => {
    const shop = await organization("Noreloadco");
    stubAutumn();
    customer = { ...team(412), billing_controls: {} };
    const path = "/v1/orgs/" + shop.org + "/billing/auto-reload/retry";
    expect((await shop.owner.client.call(path, { body: {} })).status).toBe(409);
  });
});
