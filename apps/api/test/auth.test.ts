import { withoutOrg } from "@preprocess/db/client";
import { user } from "@preprocess/db/schema/auth";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Env } from "../src/env.ts";
import {
  addMember,
  Client,
  createOrganization,
  followEmailLink,
  sent,
  signInByLink,
  signUp,
  testEnv,
  unique,
} from "./helpers.ts";

describe("sign-up and sign-in", () => {
  it("signs in by an emailed link that works once, back into the same account", async () => {
    const { email, userId } = await signUp("Ada Lovelace");
    const mail = [...sent].reverse().find((m) => m.to === email);
    expect(mail?.subject).toBe("Your sign-in link for Preprocess");

    const again = new Client();
    await signInByLink(again, email);
    const session = await again.call<{ user: { id: string } }>(
      "/api/auth/get-session",
    );
    expect(session.body.user.id).toBe(userId);

    const replay = new Client();
    await followEmailLink(replay, email);
    const none = await replay.call("/api/auth/get-session");
    expect(none.body).toBeNull();
  });

  describe("the deploy smoke test's sign-in", () => {
    const tokenFor = async (secret: string, email: string, minute: number) => {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const mac = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`smoke-test:${email}:${minute}`),
      );
      return [...new Uint8Array(mac)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    };
    const minute = () => Math.floor(Date.now() / 60_000);
    const attempt = async (
      stage: string,
      email: string,
      tokenEmail = email,
      afterAsking: () => void = () => undefined,
    ) => {
      const environment = testEnv({ STAGE: stage });
      const client = new Client(environment);
      const asked = await client.call("/api/auth/sign-in/magic-link", {
        body: { email, callbackURL: "/" },
      });
      const token = await tokenFor(
        environment.BETTER_AUTH_SECRET,
        tokenEmail.toLowerCase(),
        minute(),
      );
      afterAsking();
      const opened = await client.call(
        `/api/auth/magic-link/verify?token=${token}&callbackURL=/`,
      );
      const session = (await client.call("/api/auth/get-session")).body;
      return { asked, opened, session };
    };

    it("works on a preview for that stage's exact address", async () => {
      const email = "smoke-test+pr-7@preprocess.localhost";
      const { session } = await attempt("pr-7", email);
      expect(session).toMatchObject({ user: { email } });
    });

    it("is refused before any token on production and self-hosted installs", async () => {
      for (const stage of ["production", "selfhost", "development"]) {
        const email = `smoke-test+${stage}@preprocess.localhost`;
        const before = sent.length;
        const { asked, session } = await attempt(stage, email);
        expect(asked.status).toBe(403);
        expect(sent.slice(before).some((m) => m.to === email)).toBe(false);
        expect(session).toBeNull();
      }
    });

    it("is bound to the exact address", async () => {
      const other = await attempt(
        "pr-7",
        "smoke-test+pr-8@preprocess.localhost",
        "smoke-test+pr-7@preprocess.localhost",
      );
      expect(other.asked.status).toBe(403);
      expect(other.session).toBeNull();

      const person = `${unique("person")}@example.test`;
      const derived = await attempt("pr-7", person);
      expect(derived.asked.status).toBe(200);
      expect(derived.session).toBeNull();
    });

    it("lasts two minutes at most", async () => {
      const real = Date.now;
      try {
        const { opened, session } = await attempt(
          "staging",
          "smoke-test+staging@preprocess.localhost",
          "smoke-test+staging@preprocess.localhost",
          () => {
            const asked = real();
            Date.now = () => asked + 3 * 60_000;
          },
        );
        expect(opened.status).toBe(403);
        expect(opened.body).toMatchObject({
          message: "This address can't sign in here.",
        });
        expect(session).toBeNull();
      } finally {
        Date.now = real;
      }
    });
  });

  it("has no password sign-in or sign-up", async () => {
    const { email } = await signUp("Pat");
    const client = new Client();
    const signIn = await client.call("/api/auth/sign-in/email", {
      body: { email, password: "correct horse battery" },
    });
    expect(signIn.status).not.toBe(200);
    const signUpByPassword = await client.call("/api/auth/sign-up/email", {
      body: {
        name: "Pat",
        email: `${unique("pat")}@example.test`,
        password: "correct horse battery",
      },
    });
    expect(signUpByPassword.status).not.toBe(200);
    expect((await client.call("/api/auth/get-session")).body).toBeNull();
  });

  it("lets an existing account sign in by link to the same email", async () => {
    const environment = testEnv();
    const email = `${unique("existing")}@example.test`;
    const [existing] = await withoutOrg(environment, "test fixture", (tx) =>
      tx
        .insert(user)
        .values({
          id: unique("user"),
          name: "Old Account",
          email,
          emailVerified: true,
        })
        .returning({ id: user.id }),
    );
    const client = new Client(environment);
    await signInByLink(client, email);
    const session = await client.call<{
      user: { id: string; firstName: string | null };
    }>("/api/auth/get-session");
    expect(session.body.user.id).toBe(existing?.id);
    expect(session.body.user.firstName).toBeNull();
  });

  it("keeps first and last name separate, both required, and spells out name", async () => {
    const client = new Client();
    const email = `${unique("names")}@example.test`;
    await signInByLink(client, email);
    const fresh = await client.call<{
      user: { firstName: string | null; lastName: string | null };
    }>("/api/auth/get-session");
    expect(fresh.body.user).toMatchObject({ firstName: null, lastName: null });

    const half = await client.call<{ message: string }>(
      "/api/auth/update-user",
      { body: { firstName: "Grace" } },
    );
    expect(half.status).toBe(400);
    expect(half.body.message).toBe("Enter your first and last name.");

    const named = await client.call("/api/auth/update-user", {
      body: { firstName: " Grace ", lastName: "Hopper" },
    });
    expect(named.status).toBe(200);
    const session = await client.call<{
      user: { name: string; firstName: string; lastName: string };
    }>("/api/auth/get-session");
    expect(session.body.user).toMatchObject({
      name: "Grace Hopper",
      firstName: "Grace",
      lastName: "Hopper",
    });
  });

  it("refuses a session to a deactivated person", async () => {
    const { email, userId } = await signUp("Gone");
    const environment = testEnv();
    await withoutOrg(environment, "test fixture", (tx) =>
      tx
        .update(user)
        .set({ deactivatedAt: new Date() })
        .where(eq(user.id, userId)),
    );
    const client = new Client(environment);
    await signInByLink(client, email);
    expect((await client.call("/api/auth/get-session")).body).toBeNull();
  });

  it("is open on our cloud, and by invitation only on a self-hosted install with people", async () => {
    // Earlier tests have created people.
    const { client: owner } = await signUp("Seed");
    const org = await createOrganization(owner, "Self hosted");
    const selfHosted = testEnv({
      PREPROCESS_REGION: undefined,
    } as unknown as Partial<Env>);

    const stranger = await new Client(selfHosted).call<{ message: string }>(
      "/api/auth/sign-in/magic-link",
      { body: { email: `${unique("stranger")}@example.test` } },
    );
    expect(stranger.status).toBe(403);
    expect(stranger.body.message).toBe(
      "Sign-up on this install needs an invitation.",
    );

    const invitee = `${unique("invitee")}@example.test`;
    const invited = await owner.call("/api/auth/organization/invite-member", {
      body: { email: invitee, role: "member", organizationId: org },
    });
    expect(invited.status).toBe(200);
    const welcome = new Client(selfHosted);
    await signInByLink(welcome, invitee);
    expect((await welcome.call("/api/auth/get-session")).body).not.toBeNull();

    const cloud = await new Client(testEnv({ PREPROCESS_REGION: "us" })).call(
      "/api/auth/sign-in/magic-link",
      { body: { email: `${unique("cloud")}@example.test` } },
    );
    expect(cloud.status).toBe(200);
  });
});

describe("invitations", () => {
  it("name the organization in the email and on the signed-out preview", async () => {
    const { client, email: ownerEmail } = await signUp("Ada Lovelace");
    const org = await createOrganization(client, "Analytical Engines");
    const before = sent.length;
    const invitee = `${unique("guest")}@example.test`;
    const invited = await client.call<{ id: string }>(
      "/api/auth/organization/invite-member",
      { body: { email: invitee, role: "member", organizationId: org } },
    );
    const mail = sent.slice(before).find((m) => m.to === invitee);
    expect(mail?.subject).toBe("Join Analytical Engines on Preprocess");
    expect(mail?.text).toContain(
      `Join Analytical Engines: ${client.environment.APP_URL}/invitations/${invited.body.id}`,
    );

    const preview = await new Client().call(
      `/api/invitations/${invited.body.id}`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      email: invitee,
      organizationName: "Analytical Engines",
      inviterName: "Ada Lovelace",
      status: "pending",
    });
    expect(JSON.stringify(preview.body)).not.toContain(ownerEmail);

    const missing = await new Client().call("/api/invitations/inv_missing");
    expect(missing.status).toBe(404);
  });

  it("are accepted after signing in by link, with names the invitee enters", async () => {
    const { client } = await signUp("Owner");
    const org = await createOrganization(client, "Invites");
    const before = sent.length;
    const joined = await addMember(client, org, "Joiner Smith");
    const mail = sent.slice(before).find((m) => m.to === joined.email);
    expect(mail?.text).toContain(`/invitations/${joined.invitationId}`);
    const members = await client.call<
      { userId: string; role: string; name?: string }[]
    >(`/v1/orgs/${org}/members`);
    expect(members.body).toContainEqual(
      expect.objectContaining({ userId: joined.userId, role: "member" }),
    );
    const session = await joined.client.call<{
      user: { firstName: string; lastName: string };
    }>("/api/auth/get-session");
    expect(session.body.user).toMatchObject({
      firstName: "Joiner",
      lastName: "Smith",
    });
  });
});

describe("organizations", () => {
  it("start with an owner, a Developers group and an audit chain", async () => {
    const { client, userId } = await signUp("Grace");
    const org = await createOrganization(client, "Analytical");
    const members = await client.call<{ userId: string; role: string }[]>(
      `/v1/orgs/${org}/members`,
    );
    expect(members.body).toEqual([
      expect.objectContaining({ userId, role: "owner" }),
    ]);
    const groups = await client.call<{ slug: string; isDevelopers: boolean }[]>(
      `/v1/orgs/${org}/groups`,
    );
    expect(groups.body).toEqual([
      expect.objectContaining({ slug: "developers", isDevelopers: true }),
    ]);
    const events = await client.call<{ events: { action: string }[] }>(
      `/v1/orgs/${org}/audit-events`,
    );
    expect(events.body.events.map((e) => e.action)).toEqual([
      "organization.created",
    ]);
  });

  it("let only Owners and Admins manage groups", async () => {
    const { client } = await signUp("Boss");
    const org = await createOrganization(client, "Roles");
    const member = await addMember(client, org, "Member");
    const admin = await addMember(client, org, "Admin", "admin");

    const refused = await member.client.call(`/v1/orgs/${org}/groups`, {
      body: { name: "AP team" },
    });
    expect(refused.status).toBe(403);
    const created = await admin.client.call<{ id: string }>(
      `/v1/orgs/${org}/groups`,
      { body: { name: "AP team" } },
    );
    expect(created.status).toBe(201);
    const readable = await member.client.call(`/v1/orgs/${org}/groups`);
    expect(readable.status).toBe(200);
  });

  it("refuse callers who are not signed in", async () => {
    const { client } = await signUp("Lone");
    const org = await createOrganization(client, "Closed");
    expect((await new Client().call(`/v1/orgs/${org}/groups`)).status).toBe(
      401,
    );
  });
});

describe("API keys", () => {
  it("act for their own organization only", async () => {
    const { client } = await signUp("Keys");
    const org = await createOrganization(client, "Keyed");
    const other = await createOrganization(
      (await signUp("Other")).client,
      "Elsewhere",
    );
    const created = await client.call<{ key: string }>(
      "/api/auth/api-key/create",
      {
        body: { name: "ci", organizationId: org },
      },
    );
    expect(created.status).toBe(200);
    const keyed = new Client(testEnv(), {
      authorization: `Bearer ${created.body.key}`,
    });
    expect((await keyed.call(`/v1/orgs/${org}/groups`)).status).toBe(200);
    expect((await keyed.call(`/v1/orgs/${other}/groups`)).status).toBe(403);
    const bogus = new Client(testEnv(), { authorization: "Bearer pp_nope" });
    expect((await bogus.call(`/v1/orgs/${org}/groups`)).status).toBe(401);
  });

  it("are not capped at a handful of requests a day", async () => {
    const { client } = await signUp("Busy");
    const org = await createOrganization(client, "Busy");
    const created = await client.call<{ key: string }>(
      "/api/auth/api-key/create",
      { body: { name: "cli", organizationId: org } },
    );
    const keyed = new Client(testEnv(), { "x-api-key": created.body.key });
    for (let call = 0; call < 15; call++)
      expect((await keyed.call(`/v1/orgs/${org}/groups`)).status).toBe(200);
  });

  it("are the recorded actor for what they do, not the person who made them", async () => {
    const { client, userId } = await signUp("Keyholder");
    const org = await createOrganization(client, "Keyed audit");
    const created = await client.call<{ id: string; key: string }>(
      "/api/auth/api-key/create",
      { body: { name: "deploy", organizationId: org } },
    );
    const keyed = new Client(testEnv(), { "x-api-key": created.body.key });
    expect(
      (await keyed.call(`/v1/orgs/${org}/groups`, { body: { name: "Ops" } }))
        .status,
    ).toBe(201);
    const audit = await client.call<{
      events: { action: string; actorType: string; actorId: string }[];
    }>(`/v1/orgs/${org}/audit-events`);
    const event = audit.body.events.find((e) => e.action === "group.created");
    expect(event).toMatchObject({
      actorType: "api_key",
      actorId: created.body.id,
    });
    expect(event?.actorId).not.toBe(userId);
  });

  it("stop working once revoked, and the revoke is audited", async () => {
    const { client, userId } = await signUp("Revoker");
    const org = await createOrganization(client, "Revoked");
    const created = await client.call<{ id: string; key: string }>(
      "/api/auth/api-key/create",
      { body: { name: "old", organizationId: org } },
    );
    const listed = await client.call<{ apiKeys: { id: string }[] }>(
      `/api/auth/api-key/list?organizationId=${org}`,
    );
    expect(listed.body.apiKeys.map((k) => k.id)).toEqual([created.body.id]);
    expect(
      (
        await client.call("/api/auth/api-key/delete", {
          body: { keyId: created.body.id },
        })
      ).status,
    ).toBe(200);
    const keyed = new Client(testEnv(), { "x-api-key": created.body.key });
    expect((await keyed.call(`/v1/orgs/${org}/groups`)).status).toBe(401);
    const audit = await client.call<{
      events: { action: string; actorId: string; targetId: string }[];
    }>(`/v1/orgs/${org}/audit-events`);
    expect(
      audit.body.events.find((e) => e.action === "api_key.revoked"),
    ).toMatchObject({ actorId: userId, targetId: created.body.id });
  });
});
