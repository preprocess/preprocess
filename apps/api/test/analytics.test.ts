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
    expect(JSON.stringify(valid)).not.toMatch(/lovelace|jane@example\.com/i);

    const invalid = await signUpFrom({
      utm_source: "x".repeat(81),
      referrer_domain: "https://news.ycombinator.com/item?id=1",
    });
    expect(invalid).toMatchObject({ method: "email" });
    expect(invalid).not.toHaveProperty("utm_source");
    expect(invalid).not.toHaveProperty("referrer_domain");
  });

  it("marks a test address's events, organization and members test=true", async () => {
    const env = testEnv({
      POSTHOG_KEY: "phc_test",
      ANALYTICS_TEST_EMAILS: "qa+*@example.test",
    });
    const start = tracked.length;
    const { client, userId } = await signUp(
      "Quinn Tester",
      env,
      `qa+${crypto.randomUUID().slice(0, 8)}@example.test`,
    );
    const org = await createOrganization(client, "Test Run Org");
    const member = await addMember(client, org, "Rita Member");
    const other = await signUp("Real Person", env);
    await createOrganization(other.client, "Real Org");
    const events = since(start);

    const of = (id: string) =>
      events.filter(
        (e) =>
          e.distinctId === id ||
          e.properties.organization_id === id ||
          e.properties.$group_key === id,
      );
    // The member signed up before joining, so only what they do in the
    // organization is marked.
    const marked = [
      ...of(userId),
      ...of(org),
      ...of(member.userId).filter((e) => e.properties.organization_id === org),
    ];
    expect(marked.map((e) => e.event)).toEqual(
      expect.arrayContaining(["signed_up", "org_created", "member_joined"]),
    );
    for (const event of marked) expect(event.properties.test).toBe(true);
    expect(
      events.find((e) => e.event === "signed_up" && e.distinctId === userId)
        ?.properties.$set,
    ).toMatchObject({ test: true });
    expect(
      events
        .filter(
          (e) =>
            e.event === "$groupidentify" && e.properties.$group_key === org,
        )
        .at(-1)?.properties.$group_set,
    ).toMatchObject({ test: true });

    for (const event of of(other.userId))
      expect(event.properties).not.toHaveProperty("test");
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

// PRE-160: onboarding, collaboration and admin events, and the person and
// group properties they carry.
describe("product analytics, round 2", () => {
  const env = () => testEnv({ POSTHOG_KEY: "phc_test", STAGE: "test" });
  const named = (start: number, event: string) =>
    since(start).filter((e) => e.event === event);

  it("sets the person's sign-up method, first seen and role, and the onboarding steps", async () => {
    const start = tracked.length;
    const { client, userId } = await signUp("Onboarding Person", env());
    const org = await createOrganization(client, "Onboarding Org");

    expect(named(start, "signed_up")[0]?.properties.$set_once).toEqual({
      signup_method: "email",
      first_seen: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
    });
    expect(
      named(start, "onboarding_step_completed").map((e) => [
        e.distinctId,
        e.properties.step,
      ]),
    ).toEqual([
      [userId, "name"],
      [userId, "organization"],
    ]);
    expect(named(start, "org_created")[0]?.properties.$set).toEqual({
      role: "owner",
    });

    // Renaming oneself, or a second organization, is no onboarding step.
    const again = tracked.length;
    await client.call("/api/auth/update-user", {
      body: { firstName: "Renamed", lastName: "Person" },
    });
    await createOrganization(client, "Second Onboarding Org");
    expect(named(again, "onboarding_step_completed")).toEqual([]);

    const identified = since(start).filter(
      (e) => e.event === "$groupidentify" && e.properties.$group_key === org,
    );
    expect(identified.at(-1)?.properties.$group_set).toMatchObject({
      agents_count: 0,
      cases_30d: 0,
      has_sso: false,
      self_hosted: false,
    });
  });

  it("times an accepted invitation and follows role changes and removals", async () => {
    const { client: owner, userId: ownerId } = await signUp(
      "Team Owner",
      env(),
    );
    const org = await createOrganization(owner, "Team Org");
    const start = tracked.length;
    const { userId, invitationId } = await addMember(owner, org, "Team Mate");

    expect(named(start, "invitation_accepted")[0]).toMatchObject({
      distinctId: userId,
      properties: {
        invitation_id: invitationId,
        role: "member",
        seconds_to_accept: expect.any(Number) as number,
        accept_wait: "lt_10s",
      },
    });
    expect(named(start, "member_joined")[0]?.properties.$set).toEqual({
      role: "member",
    });

    const members = await owner.call<{
      members: { id: string; userId: string }[];
    }>(`/api/auth/organization/list-members?organizationId=${org}`);
    const memberId = members.body.members.find((m) => m.userId === userId)!.id;
    const changed = await owner.call(
      "/api/auth/organization/update-member-role",
      {
        body: { memberId, role: "admin", organizationId: org },
      },
    );
    expect(changed.status).toBe(200);
    expect(named(start, "role_changed")[0]).toMatchObject({
      distinctId: ownerId,
      properties: { member_user_id: userId, from: "member", to: "admin" },
    });
    expect(
      named(start, "$set").find((e) => e.distinctId === userId)?.properties
        .$set,
    ).toEqual({ role: "admin" });

    const removed = await owner.call("/api/auth/organization/remove-member", {
      body: { memberIdOrEmail: memberId, organizationId: org },
    });
    expect(removed.status).toBe(200);
    expect(named(start, "member_removed")[0]).toMatchObject({
      distinctId: ownerId,
      properties: { member_user_id: userId, role: "admin", via: "removed" },
    });
  });

  it("marks the organization's first API key and its revocation", async () => {
    const { client, userId } = await signUp("Key Maker", env());
    const org = await createOrganization(client, "Key Org");
    const start = tracked.length;
    const first = await client.call<{ id: string }>(
      "/api/auth/api-key/create",
      {
        body: { name: "ci", organizationId: org },
      },
    );
    const second = await client.call<{ id: string }>(
      "/api/auth/api-key/create",
      { body: { name: "cli", organizationId: org } },
    );
    await client.call("/api/auth/api-key/delete", {
      body: { keyId: first.body.id },
    });
    expect(
      named(start, "api_key_created").map((e) => e.properties.first),
    ).toEqual([true, false]);
    expect(named(start, "api_key_created")[1]?.properties.api_key_id).toBe(
      second.body.id,
    );
    expect(named(start, "api_key_revoked")[0]).toMatchObject({
      distinctId: userId,
      properties: { api_key_id: first.body.id, $groups: { organization: org } },
    });
    // A third key, after a revoke, is still not the first.
    const later = tracked.length;
    await client.call("/api/auth/api-key/create", {
      body: { name: "again", organizationId: org },
    });
    expect(named(later, "api_key_created")[0]?.properties.first).toBe(false);
  });

  it("tracks preprocess login: the approval, then the CLI's session", async () => {
    const { client: person, userId } = await signUp("Device Person", env());
    await createOrganization(person, "Device Analytics Org");
    const cli = new Client(env());
    const code = await cli.call<{ device_code: string; user_code: string }>(
      "/api/auth/device/code",
      { body: { client_id: "preprocess-cli" } },
    );
    const start = tracked.length;
    await person.call(
      `/api/auth/device?user_code=${encodeURIComponent(code.body.user_code)}`,
    );
    await person.call("/api/auth/device/approve", {
      body: { userCode: code.body.user_code },
    });
    const token = await cli.call("/api/auth/device/token", {
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: code.body.device_code,
        client_id: "preprocess-cli",
      },
    });
    expect(token.status).toBe(200);
    expect(named(start, "device_authorized")[0]?.distinctId).toBe(userId);
    expect(named(start, "cli_login")[0]?.distinctId).toBe(userId);
  });

  it("tracks a group once it commits, and not a refused duplicate", async () => {
    const { client } = await signUp("Group Maker", env());
    const org = await createOrganization(client, "Group Org");
    const start = tracked.length;
    const body = { name: "Finance", slug: "finance" };
    const created = await client.call<{ id: string }>(
      `/v1/orgs/${org}/groups`,
      { body },
    );
    expect(created.status).toBe(201);
    const again = await client.call(`/v1/orgs/${org}/groups`, { body });
    expect(again.status).toBe(409);
    expect(
      named(start, "group_created").map((e) => e.properties.group_id),
    ).toEqual([created.body.id]);
  });

  it("tracks each retention period changed", async () => {
    const { client } = await signUp("Retention Owner", env());
    const org = await createOrganization(client, "Retention Analytics Org");
    const start = tracked.length;
    const changed = await client.call(`/v1/orgs/${org}/retention`, {
      method: "PUT",
      body: { documentsDays: 30 },
    });
    expect(changed.status).toBe(200);
    expect(named(start, "retention_changed")[0]?.properties).toMatchObject({
      setting: "documents",
      days: 30,
      shortened: true,
    });
  });
});
