import { withoutOrg } from "@preprocess/db/client";
import { user } from "@preprocess/db/schema/auth";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Env } from "../src/env.ts";
import {
  addMember,
  Client,
  createOrganization,
  sent,
  signUp,
  testEnv,
  unique,
} from "./helpers.ts";

describe("sign-up and sign-in", () => {
  it("creates a session, refuses a wrong password, and signs back in", async () => {
    const { client, email } = await signUp("Ada");
    const session = await client.call<{ user: { email: string } }>(
      "/api/auth/get-session",
    );
    expect(session.body.user.email).toBe(email);

    const fresh = new Client();
    const wrong = await fresh.call("/api/auth/sign-in/email", {
      body: { email, password: "wrong password!" },
    });
    expect(wrong.status).toBe(401);
    const right = await fresh.call("/api/auth/sign-in/email", {
      body: { email, password: "correct horse battery" },
    });
    expect(right.status).toBe(200);
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
    const result = await new Client(environment).call(
      "/api/auth/sign-in/email",
      {
        body: { email, password: "correct horse battery" },
      },
    );
    expect(result.status).toBe(403);
  });

  it("is open on our cloud, and by invitation only on a self-hosted install with people", async () => {
    // Earlier tests have created people.
    await signUp("Seed");
    const selfHosted = testEnv({
      PREPROCESS_REGION: undefined,
    } as unknown as Partial<Env>);
    const stranger = await new Client(selfHosted).call(
      "/api/auth/sign-up/email",
      {
        body: {
          name: "Stranger",
          email: `${unique("stranger")}@example.test`,
          password: "correct horse battery",
        },
      },
    );
    expect(stranger.status).toBe(403);

    const cloud = await new Client(testEnv({ PREPROCESS_REGION: "us" })).call(
      "/api/auth/sign-up/email",
      {
        body: {
          name: "Cloud",
          email: `${unique("cloud")}@example.test`,
          password: "correct horse battery",
        },
      },
    );
    expect(cloud.status).toBe(200);
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

  it("invite by email with a link to accept", async () => {
    const { client } = await signUp("Owner");
    const org = await createOrganization(client, "Invites");
    const before = sent.length;
    const joined = await addMember(client, org, "Joiner");
    const mail = sent.slice(before).find((m) => m.to === joined.email);
    expect(mail?.text).toContain(`/invitations/${joined.invitationId}`);
    const members = await client.call<{ userId: string; role: string }[]>(
      `/v1/orgs/${org}/members`,
    );
    expect(members.body).toContainEqual(
      expect.objectContaining({ userId: joined.userId, role: "member" }),
    );
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
});
