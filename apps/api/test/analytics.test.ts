// Product analytics (PRE-156): auth's lifecycle events reach the queue only
// after their transaction commits, carry the organization group and no
// email or name, and nothing is queued without a PostHog key.

import { describe, expect, it } from "vitest";

import {
  addMember,
  createOrganization,
  signUp,
  testEnv,
  tracked,
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
});
