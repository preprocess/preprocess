// Per-organization rate limits (spec 15): one organization, API key or client
// address running out of requests leaves the others untouched.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { LIMITS, rateLimitName } from "../src/rate-limit.ts";
import {
  Client,
  createOrganization,
  signUp,
  testEnv,
  tracked,
  unique,
} from "./helpers.ts";

// Uses up a bucket the way that many requests would. Counts reset each
// minute, so this stays clear of a window's last seconds.
const exhaust = async (name: string, bucket: string, limit: number) => {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < 10_000) await new Promise((r) => setTimeout(r, left + 50));
  const limiter = env.RATE_LIMITER.getByName(name);
  await Promise.all(
    Array.from({ length: limit }, () =>
      limiter.take([{ name: bucket, limit }]),
    ),
  );
};

const expectLimited = (response: {
  status: number;
  body: unknown;
  headers: Headers;
}) => {
  expect(response.status).toBe(429);
  expect(response.body).toMatchObject({ error: "rate_limited" });
  const retryAfter = Number(response.headers.get("retry-after"));
  expect(retryAfter).toBeGreaterThanOrEqual(1);
  expect(retryAfter).toBeLessThanOrEqual(60);
};

describe("rate limits", { timeout: 30_000 }, () => {
  it("limit one organization's /v1 requests and not another's", async () => {
    const a = await signUp("Rae");
    const orgA = await createOrganization(a.client, "Rate A");
    const b = await signUp("Ray");
    const orgB = await createOrganization(b.client, "Rate B");

    await exhaust(rateLimitName.org(orgA), "org", LIMITS.org);
    // The limiter answers after the response, so the request that finds the
    // bucket full still gets through and the next one is refused.
    expect((await a.client.call(`/v1/orgs/${orgA}/groups`)).status).toBe(200);
    expectLimited(await a.client.call(`/v1/orgs/${orgA}/groups`));
    expect((await b.client.call(`/v1/orgs/${orgB}/groups`)).status).toBe(200);
  });

  it("limit one API key and not the organization's other keys", async () => {
    const owner = await signUp("Kay");
    const org = await createOrganization(owner.client, "Keys");
    const create = (name: string) =>
      owner.client.call<{ id: string; key: string }>(
        "/api/auth/api-key/create",
        { body: { name, organizationId: org } },
      );
    const first = (await create("first")).body;
    const second = (await create("second")).body;
    const keyed = (key: string) =>
      new Client(owner.client.environment, { authorization: `Bearer ${key}` });

    await exhaust(rateLimitName.org(org), `key:${first.id}`, LIMITS.apiKey);
    const limited = keyed(first.key);
    expect((await limited.call(`/v1/orgs/${org}/groups`)).status).toBe(200);
    expectLimited(await limited.call(`/v1/orgs/${org}/groups`));
    expect(
      (await keyed(second.key).call(`/v1/orgs/${org}/groups`)).status,
    ).toBe(200);
  });

  it("never limit our own organizations", async () => {
    const owner = await signUp("Ina");
    const org = await createOrganization(owner.client, "Internal");
    await exhaust(rateLimitName.org(org), "org", LIMITS.org);
    owner.client.environment.BILLING_INTERNAL_ORGS = org;
    try {
      for (let i = 0; i < 2; i++)
        expect((await owner.client.call(`/v1/orgs/${org}/groups`)).status).toBe(
          200,
        );
    } finally {
      delete owner.client.environment.BILLING_INTERNAL_ORGS;
    }
  });

  it("limit sign-in attempts per client address", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
    const from = (address: string) =>
      new Client(testEnv(), { "cf-connecting-ip": address });
    const ask = (client: Client) =>
      client.call("/api/auth/sign-in/magic-link", {
        body: { email: `${unique("ip")}@example.test`, callbackURL: "/" },
      });

    await exhaust(rateLimitName.auth(ip), "auth", LIMITS.auth);
    expectLimited(await ask(from(ip)));
    expect(
      (await ask(from(`198.51.100.${Math.floor(Math.random() * 250)}`))).status,
    ).toBe(200);
    // Reading the session is not an attempt.
    expect((await from(ip).call("/api/auth/get-session")).status).toBe(200);
  });

  // Product analytics (PRE-160): a refusal is a rate_limited event, once per
  // limit and window however often the caller retries.
  it("report a full organization limit once, on its group", async () => {
    const { client, userId } = await signUp(
      "Rita",
      testEnv({ POSTHOG_KEY: "phc_test" }),
    );
    const org = await createOrganization(client, "Rate Events");
    await exhaust(rateLimitName.org(org), "org", LIMITS.org);
    const start = tracked.length;
    expect((await client.call(`/v1/orgs/${org}/groups`)).status).toBe(200);
    for (let i = 0; i < 3; i++)
      expectLimited(await client.call(`/v1/orgs/${org}/groups`));
    const events = tracked
      .slice(start)
      .filter((e) => e.event === "rate_limited");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      distinctId: userId,
      properties: { scope: "org", $groups: { organization: org } },
    });
  });

  it("report a full sign-in limit without an organization or address", async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 250)}`;
    const client = new Client(testEnv({ POSTHOG_KEY: "phc_test" }), {
      "cf-connecting-ip": ip,
    });
    await exhaust(rateLimitName.auth(ip), "auth", LIMITS.auth);
    const start = tracked.length;
    for (let i = 0; i < 2; i++)
      expectLimited(
        await client.call("/api/auth/sign-in/magic-link", {
          body: { email: `${unique("ip")}@example.test`, callbackURL: "/" },
        }),
      );
    const events = tracked
      .slice(start)
      .filter((e) => e.event === "rate_limited");
    expect(events).toHaveLength(1);
    expect(events[0]?.properties).toMatchObject({ scope: "sign_in" });
    expect(events[0]?.properties.$groups).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain(ip);
  });
});
