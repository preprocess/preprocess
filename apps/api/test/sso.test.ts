// Single sign-on (spec 13, PRE-137): an organization's SAML or OIDC
// connection, its domain proof, enforced SSO and JIT provisioning, gated by
// plan. The identity provider and DNS are fakes (test/fake-idp.ts); Autumn is
// stubbed per organization.

import { orgId, withoutOrg } from "@preprocess/db/client";
import { auditEvents } from "@preprocess/db/schema/audit";
import { member, user } from "@preprocess/db/schema/auth";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env.ts";
import { IDP, SAML_ENTITY, SAML_SSO_URL } from "./idp.ts";
import {
  addMember,
  Client,
  createOrganization,
  signInByLink,
  signUp,
  testEnv,
  unique,
} from "./helpers.ts";

const realFetch = globalThis.fetch;
const plans = new Map<string, { plan: string; flags: string[] }>();
beforeAll(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.useautumn.com") return realFetch(input, init);
    const body = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    ) as { customer_id?: string };
    const given = plans.get(body.customer_id ?? "");
    return Promise.resolve(
      Response.json({
        id: body.customer_id,
        subscriptions: given ? [{ plan_id: given.plan, status: "active" }] : [],
        flags: Object.fromEntries((given?.flags ?? []).map((f) => [f, {}])),
        balances: {},
      }),
    );
  });
});
afterAll(() => vi.restoreAllMocks());

const environment: Env = testEnv({ AUTUMN_SECRET_KEY: "am_sk_test_stub" });
const internal = { plan: "internal", flags: ["sso", "scim", "audit_export"] };
const team = { plan: "team", flags: ["custom_sandbox_images"] };

type SamlAnswer = { acs: string; SAMLResponse: string; RelayState: string };

type Connection = {
  providerId: string;
  domains: string[];
  domainVerified: boolean;
  verification: { name: string; value: string } | null;
  enforced: boolean;
  jit: boolean;
  serviceProvider: {
    entityId: string | null;
    acsUrl: string | null;
    redirectUrl: string | null;
  };
};

// An Owner whose own address is at the organization's domain, so enforced
// SSO covers them too.
const organization = async (plan = internal) => {
  const domain = `${unique("acme")}.test`;
  const owner = await signUp("Olive Owner", environment, `olive@${domain}`);
  const org = await createOrganization(owner.client, "Acme");
  plans.set(org, plan);
  return { domain, org, owner };
};

const oidc = (domain: string, extra: object = {}) => ({
  protocol: "oidc",
  domains: [domain],
  issuer: IDP,
  clientId: "preprocess",
  clientSecret: "shh",
  ...extra,
});

const publish = (name: string, value: string) =>
  fetch(`${IDP}/__dns`, {
    method: "POST",
    body: JSON.stringify({ name, value }),
  });

const connect = async (
  owner: Client,
  org: string,
  domain: string,
  extra = {},
) => {
  const saved = await owner.call<Connection>(`/v1/orgs/${org}/sso`, {
    method: "PUT",
    body: oidc(domain, extra),
  });
  expect(saved.status).toBe(200);
  const record = saved.body.verification!;
  await publish(`${record.name}.${domain}`, record.value);
  const verified = await owner.call<Connection>(
    `/v1/orgs/${org}/sso/verify-domain`,
    { method: "POST" },
  );
  expect(verified.status).toBe(200);
  return verified.body;
};

// The browser's trip: ask for SSO, the IdP signs the person in, back to our
// callback.
const ssoSignIn = async (email: string, sub = email) => {
  const client = new Client(environment);
  const started = await client.call<{ url: string }>("/api/auth/sign-in/sso", {
    body: { email, callbackURL: "/" },
  });
  expect(started.status).toBe(200);
  await fetch(`${IDP}/__next`, {
    method: "POST",
    body: JSON.stringify({ sub, email, given_name: "Sam", family_name: "Sso" }),
  });
  const authorized = await fetch(started.body.url, { redirect: "manual" });
  const back = new URL(authorized.headers.get("location")!);
  const landed = await client.call(back.pathname + back.search);
  const session = await client.call<{ user: { id: string } } | null>(
    "/api/auth/get-session",
  );
  return { client, landed, userId: session.body?.user.id };
};

const events = (org: string, action: string) =>
  withoutOrg(environment, "test", (tx) =>
    tx
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, org),
          eq(auditEvents.action, action),
        ),
      ),
  );

const isMember = (org: string, userId: string) =>
  withoutOrg(
    environment,
    "test",
    async (tx) =>
      (
        await tx
          .select()
          .from(member)
          .where(and(eq(member.organizationId, org), eq(member.userId, userId)))
      ).length === 1,
  );

describe("SSO settings", () => {
  it("are refused on plans without SSO, and allowed on Internal", async () => {
    const onTeam = await organization(team);
    const read = await onTeam.owner.client.call<{ allowed: boolean }>(
      `/v1/orgs/${onTeam.org}/sso`,
    );
    expect(read.body).toEqual({ allowed: false, connection: null });
    const refused = await onTeam.owner.client.call(
      `/v1/orgs/${onTeam.org}/sso`,
      {
        method: "PUT",
        body: oidc(onTeam.domain),
      },
    );
    expect(refused.status).toBe(403);

    const onInternal = await organization();
    const saved = await onInternal.owner.client.call<Connection>(
      `/v1/orgs/${onInternal.org}/sso`,
      { method: "PUT", body: oidc(onInternal.domain) },
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      providerId: onInternal.org,
      domains: [onInternal.domain],
      domainVerified: false,
      enforced: false,
      jit: true,
    });
    expect(saved.body.serviceProvider.redirectUrl).toContain(
      `/api/auth/sso/callback/${onInternal.org}`,
    );
    expect(await events(onInternal.org, "sso.connection.created")).toHaveLength(
      1,
    );
  });

  it("are for Owners only, and never reach another organization", async () => {
    const { org, owner, domain } = await organization();
    const admin = await addMember(owner.client, org, "Ada Admin", "admin");
    expect((await admin.client.call(`/v1/orgs/${org}/sso`)).status).toBe(403);
    expect(
      (
        await admin.client.call(`/v1/orgs/${org}/sso`, {
          method: "PUT",
          body: oidc(domain),
        })
      ).status,
    ).toBe(403);
    const other = await organization();
    expect((await other.owner.client.call(`/v1/orgs/${org}/sso`)).status).toBe(
      403,
    );
    // The plugin's own management routes are off; routes/sso.ts is the way.
    expect(
      (
        await owner.client.call("/api/auth/sso/register", {
          body: { providerId: "x", issuer: IDP, domain, organizationId: org },
        })
      ).status,
    ).toBe(404);
  });

  it("verify the domain by its DNS TXT record", async () => {
    const { org, owner, domain } = await organization();
    const saved = await owner.client.call<Connection>(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: oidc(domain),
    });
    const record = saved.body.verification!;
    expect(record.name).toBe(`_preprocess-sso-${org}`);
    const early = await owner.client.call(`/v1/orgs/${org}/sso/verify-domain`, {
      method: "POST",
    });
    expect(early.status).toBe(409);
    // Nobody signs in through an unverified domain.
    const client = new Client(environment);
    const refused = await client.call("/api/auth/sign-in/sso", {
      body: { email: `sam@${domain}`, callbackURL: "/" },
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);

    await publish(`${record.name}.${domain}`, record.value);
    const verified = await owner.client.call<Connection>(
      `/v1/orgs/${org}/sso/verify-domain`,
      { method: "POST" },
    );
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({
      domainVerified: true,
      verification: null,
    });
    expect(await events(org, "sso.domain.verified")).toHaveLength(1);
  });
});

describe("SSO sign-in", () => {
  it("adds a new person to the organization with JIT, audited", async () => {
    const { org, owner, domain } = await organization();
    await connect(owner.client, org, domain);
    const { landed, userId } = await ssoSignIn(`sam@${domain}`);
    expect(landed.status).toBe(302);
    expect(userId).toBeDefined();
    expect(await isMember(org, userId!)).toBe(true);
    const added = await events(org, "member.added");
    expect(added.find((e) => e.targetId === userId)).toMatchObject({
      actorType: "platform",
      actorId: "platform:sso",
    });
  });

  it("with JIT off, takes only members and invited people", async () => {
    const { org, owner, domain } = await organization();
    await connect(owner.client, org, domain, { jit: false });
    const stranger = await ssoSignIn(`stranger@${domain}`);
    expect(stranger.userId).toBeUndefined();
    const found = await withoutOrg(environment, "test", (tx) =>
      tx
        .select()
        .from(user)
        .where(eq(user.email, `stranger@${domain}`)),
    );
    expect(found).toHaveLength(0);

    const invited = await owner.client.call(
      "/api/auth/organization/invite-member",
      {
        body: { email: `ivy@${domain}`, role: "member", organizationId: org },
      },
    );
    expect(invited.status).toBe(200);
    const ivy = await ssoSignIn(`ivy@${domain}`);
    expect(ivy.userId).toBeDefined();
    // The invitation is still hers to accept, with its role.
    expect(await isMember(org, ivy.userId!)).toBe(false);
  });

  it("once enforced, turns other sign-in off at the domain, except for Owners", async () => {
    const { org, owner, domain } = await organization();
    const jo = await signUp("Jo Member", environment, `jo@${domain}`);
    await connect(owner.client, org, domain, { enforced: true });
    const byLink = await signInByLink(new Client(environment), `jo@${domain}`);
    expect(byLink.status).toBe(403);
    expect(JSON.stringify(byLink.body)).toContain("SSO_REQUIRED");
    // Elsewhere, and for the Owner, links still work.
    expect(
      (
        await signInByLink(
          new Client(environment),
          `${unique("x")}@example.test`,
        )
      ).status,
    ).toBeLessThan(400);
    expect(
      (await signInByLink(new Client(environment), `olive@${domain}`)).status,
    ).toBeLessThan(400);
    // Jo signs in through SSO into the same account.
    const sso = await ssoSignIn(`jo@${domain}`);
    expect(sso.userId).toBe(jo.userId);
    const updated = await events(org, "sso.connection.updated");
    expect(updated).toHaveLength(0);
  });

  it("keeps working when the plan lapses, and the settings turn read-only", async () => {
    const { org, owner, domain } = await organization();
    await connect(owner.client, org, domain);
    plans.set(org, team);
    // The plan is cached for 30 seconds per isolate.
    const later = Date.now() + 60_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => later);
    const { userId } = await ssoSignIn(`late@${domain}`);
    expect(userId).toBeDefined();
    const read = await owner.client.call<{
      allowed: boolean;
      connection: Connection;
    }>(`/v1/orgs/${org}/sso`);
    expect(read.body.allowed).toBe(false);
    expect(read.body.connection.domainVerified).toBe(true);
    for (const [path, method] of [
      [`/v1/orgs/${org}/sso`, "PUT"],
      [`/v1/orgs/${org}/sso`, "DELETE"],
    ] as const)
      expect(
        (
          await owner.client.call(path, {
            method,
            body: method === "PUT" ? oidc(domain) : undefined,
          })
        ).status,
      ).toBe(403);
    clock.mockRestore();
  });

  it("works over SAML, signed by the IdP's certificate", async () => {
    const { org, owner, domain } = await organization();
    const certificate = await (await fetch(`${IDP}/saml/cert`)).text();
    const saved = await owner.client.call<Connection>(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: {
        protocol: "saml",
        domains: [domain],
        idpEntityId: SAML_ENTITY,
        ssoUrl: SAML_SSO_URL,
        certificate,
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.serviceProvider.entityId).toContain(
      `/api/auth/sso/saml2/sp/metadata?providerId=${org}`,
    );
    expect(saved.body.serviceProvider.acsUrl).toContain(
      `/api/auth/sso/saml2/sp/acs/${org}`,
    );
    const record = saved.body.verification!;
    await publish(`${record.name}.${domain}`, record.value);
    await owner.client.call(`/v1/orgs/${org}/sso/verify-domain`, {
      method: "POST",
    });

    const client = new Client(environment);
    const email = `sal@${domain}`;
    const started = await client.call<{ url: string }>(
      "/api/auth/sign-in/sso",
      {
        body: { email, callbackURL: "/" },
      },
    );
    expect(started.status).toBe(200);
    await fetch(`${IDP}/__next`, {
      method: "POST",
      body: JSON.stringify({ sub: email, email }),
    });
    const answer = await (await fetch(started.body.url)).json<SamlAnswer>();
    const acs = new URL(answer.acs);
    const landed = await client.call(acs.pathname, {
      form: {
        SAMLResponse: answer.SAMLResponse,
        RelayState: answer.RelayState,
      },
    });
    expect(landed.status).toBe(302);
    const session = await client.call<{
      user: { id: string; email: string };
    } | null>("/api/auth/get-session");
    expect(session.body?.user.email).toBe(email);
    expect(await isMember(org, session.body!.user.id)).toBe(true);

    // An assertion changed after the IdP signed it signs nobody in.
    const mallory = new Client(environment);
    const again = await mallory.call<{ url: string }>("/api/auth/sign-in/sso", {
      body: { email: `mallory@${domain}`, callbackURL: "/" },
    });
    await fetch(`${IDP}/__next`, {
      method: "POST",
      body: JSON.stringify({ sub: "m", email: `mallory@${domain}` }),
    });
    const signed = await (await fetch(again.body.url)).json<SamlAnswer>();
    const forged = btoa(
      atob(signed.SAMLResponse).replaceAll(
        `mallory@${domain}`,
        `olive@${domain}`,
      ),
    );
    await mallory.call(acs.pathname, {
      form: { SAMLResponse: forged, RelayState: signed.RelayState },
    });
    expect(
      (await mallory.call<unknown>("/api/auth/get-session")).body,
    ).toBeNull();
  });

  it("is audited when the connection changes or goes away", async () => {
    const { org, owner, domain } = await organization();
    await connect(owner.client, org, domain);
    const changed = await owner.client.call(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: oidc(domain, { clientSecret: undefined, enforced: true }),
    });
    expect(changed.status).toBe(200);
    const [updated] = await events(org, "sso.connection.updated");
    expect(updated?.data).toMatchObject({
      enforced: true,
      from: { enforced: false },
    });
    const removed = await owner.client.call(`/v1/orgs/${org}/sso`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
    expect(await events(org, "sso.connection.deleted")).toHaveLength(1);
    expect(
      (await owner.client.call<{ connection: null }>(`/v1/orgs/${org}/sso`))
        .body.connection,
    ).toBeNull();
    void orgId;
  });
});
