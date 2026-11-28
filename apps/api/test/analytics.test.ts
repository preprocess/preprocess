// Product analytics (PRE-156): auth's lifecycle events reach the queue only
// after their transaction commits, carry the organization group and no
// email or name, and nothing is queued without a PostHog key.

import { describe, expect, it, vi } from "vitest";

import { SIGNUP_ATTRIBUTION_COOKIE } from "../src/auth.ts";
import {
  addMember,
  Client,
  createOrganization,
  signInByLink,
  signUp,
  testEnv,
  tracked,
  unique,
} from "./helpers.ts";

const since = (start: number) => tracked.slice(start);

describe("product analytics", () => {
  it("queues sign-up, organization and membership events with the group", async () => {
    const env = testEnv({ POSTHOG_KEY: "phc_test", STAGE: "test" });
    const start = tracked.length;
    const { client, userId, email } = await signUp("Ada Analytics", env);
    const org = await createOrganization(client, "Analytics Org");
    const member = await addMember(client, org, "Grace Analytics");
    const events = since(start);

    const signedUp = events.find((e) => e.event === "signed_up");
    expect(signedUp).toMatchObject({
      distinctId: userId,
      properties: { method: "email", stage: "test" },
    });
    expect(signedUp?.properties.$groups).toBeUndefined();

    expect(events.find((e) => e.event === "org_created")).toMatchObject({
      distinctId: userId,
      properties: {
        organization_id: org,
        $groups: { organization: org },
      },
    });
    expect(events.find((e) => e.event === "member_invited")).toMatchObject({
      distinctId: userId,
      properties: { role: "member", $groups: { organization: org } },
    });
    expect(events.find((e) => e.event === "member_joined")).toMatchObject({
      distinctId: member.userId,
      properties: {
        member_user_id: member.userId,
        role: "member",
        via: "invitation",
        $groups: { organization: org },
      },
    });

    const identified = events.filter(
      (e) => e.event === "$groupidentify" && e.properties.$group_key === org,
    );
    expect(identified.length).toBeGreaterThan(0);
    expect(identified.at(-1)?.properties.$group_set).toMatchObject({
      plan: expect.any(String) as string,
      seats: expect.any(Number) as number,
      created_at: expect.any(String) as string,
    });

    const sent = JSON.stringify(events);
    expect(sent).not.toContain(email);
    expect(sent).not.toContain("Ada");
    expect(sent).not.toContain("Analytics Org");
  });

  it("puts the marketing link's UTM slugs and referring domain on signed_up", async () => {
    const env = testEnv({ POSTHOG_KEY: "phc_test", STAGE: "test" });
    const signUpFrom = async (attribution: Record<string, string>) => {
      const email = `${unique("utm-person")}@example.test`;
      const client = new Client(env);
      client.cookie = `${SIGNUP_ATTRIBUTION_COOKIE}=${encodeURIComponent(
        new URLSearchParams(attribution).toString(),
      )}`;
      const start = tracked.length;
      const signedIn = await signInByLink(client, email);
      expect(signedIn.status).toBeLessThan(400);
      const event = since(start).find((e) => e.event === "signed_up");
      expect(JSON.stringify(event)).not.toContain(email);
      return event?.properties;
    };

    const valid = await signUpFrom({
      utm_source: "Google",
      utm_medium: "cpc",
      utm_campaign: "launch-2026",
      utm_content: "Black Friday Sale",
      utm_term: "jane@example.com",
      referrer_domain: "News.YCombinator.com",
      name: "Ada Lovelace",
    });
    expect(valid).toMatchObject({
      method: "email",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "launch-2026",
      referrer_domain: "news.ycombinator.com",
    });
    expect(valid).not.toHaveProperty("utm_content");
    expect(valid).not.toHaveProperty("utm_term");
    expect(valid).not.toHaveProperty("name");
    expect(JSON.stringify(valid)).not.toMatch(/ada|lovelace|jane/i);

    const invalid = await signUpFrom({
      utm_source: "x".repeat(81),
      referrer_domain: "https://news.ycombinator.com/item?id=1",
    });
    expect(invalid).toMatchObject({ method: "email" });
    expect(invalid).not.toHaveProperty("utm_source");
    expect(invalid).not.toHaveProperty("referrer_domain");
  });

  it("queues nothing without a PostHog key", async () => {
    const start = tracked.length;
    const { client } = await signUp("Quiet Person", testEnv());
    await createOrganization(client, "Quiet Org");
    expect(since(start)).toEqual([]);
  });

  it("queues nothing for a request that is rolled back", async () => {
    const env = testEnv({ POSTHOG_KEY: "phc_test" });
    const { client } = await signUp("Taken Slug", env);
    const slug = `taken-${crypto.randomUUID().slice(0, 8)}`;
    const first = await client.call("/api/auth/organization/create", {
      body: { name: "First", slug },
    });
    expect(first.status).toBe(200);
    const start = tracked.length;
    const again = await client.call("/api/auth/organization/create", {
      body: { name: "Second", slug },
    });
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(since(start).filter((e) => e.event === "org_created")).toEqual([]);
  });

  // PRE-160: an organization's failed requests, one client error in ten.
  it("queues a sampled client error with its route template and weight", async () => {
    const env = testEnv({ POSTHOG_KEY: "phc_test" });
    const { client, userId } = await signUp("Erin Errors", env);
    const org = await createOrganization(client, "Error Org");
    const path = `/v1/orgs/${org}/agents/no-such-agent`;
    const random = vi.spyOn(Math, "random");
    try {
      random.mockReturnValue(0.5);
      let start = tracked.length;
      expect((await client.call(path)).status).toBe(404);
      expect(since(start).filter((e) => e.event === "api_error")).toEqual([]);

      random.mockReturnValue(0);
      start = tracked.length;
      expect((await client.call(path)).status).toBe(404);
      const [error] = since(start).filter((e) => e.event === "api_error");
      expect(error).toMatchObject({
        distinctId: userId,
        properties: {
          route: "/v1/orgs/:org/agents/:agent",
          method: "get",
          status: 404,
          status_class: "client_error",
          caller: "person",
          weight: 10,
          $groups: { organization: org },
        },
      });
      expect(JSON.stringify(error)).not.toContain("no-such-agent");
    } finally {
      random.mockRestore();
    }
  });
});
