// Single sign-on (spec 13, PRE-137): an organization's SAML or OIDC
// connection, its email domains proved by DNS, the test sign-in, Require SSO
// and JIT provisioning, gated by role, plan and license. The identity
// provider and DNS are fakes (test/fake-idp.ts); Autumn is stubbed per
// organization, and the self-hosted license is signed here.

import { withoutOrg } from "@preprocess/db/client";
import { groupMembers } from "@preprocess/db/schema/access";
import { auditEvents } from "@preprocess/db/schema/audit";
import { member, session, user } from "@preprocess/db/schema/auth";
import { ssoDomains } from "@preprocess/db/schema/sso";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env.ts";
import { licenseKeys } from "../src/license.ts";
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
const LICENSE_KID = "sso-test-only";
let licenseKey: CryptoKeyPair;
beforeAll(async () => {
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
  licenseKey = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  licenseKeys[LICENSE_KID] = base64url(
    new Uint8Array(
      (await crypto.subtle.exportKey(
        "raw",
        licenseKey.publicKey,
      )) as ArrayBuffer,
    ),
  );
});
afterAll(() => {
  delete licenseKeys[LICENSE_KID];
  vi.restoreAllMocks();
});

const day = 24 * 60 * 60 * 1000;
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const license = async (features: string[], expiresAt: Date) => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      kid: LICENSE_KID,
      customer: "Acme Corp",
      features,
      seats: 50,
      issuedAt: new Date(expiresAt.getTime() - 365 * day).toISOString(),
      expiresAt: expiresAt.toISOString(),
    }),
  );
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    licenseKey.privateKey,
    bytes,
  );
  return `${base64url(bytes)}.${base64url(new Uint8Array(signature))}`;
};
const selfHosted = (key: string): Env =>
  testEnv({
    PREPROCESS_REGION: undefined,
    PREPROCESS_LICENSE_KEY: key,
  } as unknown as Partial<Env>);

const environment: Env = testEnv({ AUTUMN_SECRET_KEY: "am_sk_test_stub" });
const internal = { plan: "internal", flags: ["sso", "scim", "audit_export"] };
const team = { plan: "team", flags: ["custom_sandbox_images"] };

type SamlAnswer = { acs: string; SAMLResponse: string; RelayState: string };

type Domain = {
  domain: string;
  status: "pending" | "verified" | "failed";
  checkedAt: string | null;
  failureReason: string | null;
  record: { type: "TXT"; name: string; value: string };
};
type Test =
  | { ok: true; at: string; by: { id: string; name: string }; email: string }
  | { ok: false; reason: string; idpMessage: string };
type Settings = {
  access: {
    available: boolean;
    reason: string | null;
    licenseExpiredAt: string | null;
    canEdit: boolean;
    role: string;
  };
  serviceProvider: { acsUrl: string; entityId: string; redirectUri: string };
  connection: {
    protocol: "saml" | "oidc";
    saml: {
      metadataUrl: string | null;
      pastedXml: boolean;
      metadataReadAt: string | null;
      certificateExpiresAt: string | null;
      idpEntityId: string | null;
    } | null;
    oidc: { issuer: string; clientId: string; hasSecret: boolean } | null;
    lastTest: Test | null;
    requireSso: boolean;
    jit: boolean;
    defaultGroupId: string | null;
  } | null;
  domains: Domain[];
  allowed: boolean;
};
// What PUT /sso and #217's POST /sso/verify-domain answer: the connection,
// with #217's deprecated fields.
type Connection = NonNullable<Settings["connection"]> & {
  providerId: string;
  issuer: string;
  domains: string[];
  domainVerified: boolean;
  verification: { name: string; value: string } | null;
  enforced: boolean;
  serviceProvider: {
    entityId: string | null;
    acsUrl: string | null;
    metadataUrl: string | null;
    redirectUrl: string | null;
  };
};

// An Owner whose own address is at the organization's domain, so Require SSO
// covers them too.
const organization = async (plan = internal) => {
  const domain = `${unique("acme")}.test`;
  const owner = await signUp("Olive Owner", environment, `olive@${domain}`);
  const org = await createOrganization(owner.client, "Acme");
  plans.set(org, plan);
  return { domain, org, owner };
};

const oidc = (extra: object = {}) => ({
  protocol: "oidc",
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

const next = (person: object) =>
  fetch(`${IDP}/__next`, { method: "POST", body: JSON.stringify(person) });

const settings = (client: Client, org: string) =>
  client.call<Settings>(`/v1/orgs/${org}/sso`);

const addDomain = (client: Client, org: string, domain: string) =>
  client.call<Domain & { error?: { code: string } }>(
    `/v1/orgs/${org}/sso/domains`,
    { body: { domain } },
  );

const checkDomain = (client: Client, org: string, domain: string) =>
  client.call<Domain & { error?: { code: string } }>(
    `/v1/orgs/${org}/sso/domains/${domain}/check`,
    { method: "POST" },
  );

const verify = async (owner: Client, org: string, domain: string) => {
  const added = await addDomain(owner, org, domain);
  expect(added.status).toBe(201);
  await publish(added.body.record.name, added.body.record.value);
  const checked = await checkDomain(owner, org, domain);
  expect(checked.body.status).toBe("verified");
};

const signIn = (client: Client, org: string, body: object) =>
  client.call<Settings & { error?: { code: string } }>(
    `/v1/orgs/${org}/sso/sign-in`,
    { method: "PATCH", body },
  );

const connect = async (
  owner: Client,
  org: string,
  domain: string,
  extra: object = {},
) => {
  const saved = await owner.call<Settings>(`/v1/orgs/${org}/sso`, {
    method: "PUT",
    body: oidc(extra),
  });
  expect(saved.status).toBe(200);
  await verify(owner, org, domain);
};

// The tester's popup: start the test with the Owner's session, the IdP signs
// someone in (or refuses), back to our callback, which answers with the done
// page.
const testSignIn = async (owner: Client, org: string, person: object) => {
  const popup = new Client(owner.environment);
  popup.cookie = owner.cookie;
  const started = await popup.call(`/v1/orgs/${org}/sso/test`);
  expect(started.status).toBe(302);
  await next(person);
  const authorized = await fetch(started.headers.get("location")!, {
    redirect: "manual",
  });
  const back = new URL(authorized.headers.get("location")!);
  const landed = await popup.call<string>(back.pathname + back.search);
  return { popup, landed };
};

// The browser's trip: ask for SSO, the IdP signs the person in, back to our
// callback.
const ssoSignIn = async (email: string, sub = email, env = environment) => {
  const client = new Client(env);
  const started = await client.call<{ url: string }>("/api/auth/sign-in/sso", {
    body: { email, callbackURL: "/" },
  });
  if (started.status !== 200)
    return { client, landed: started, userId: undefined };
  await next({ sub, email, given_name: "Sam", family_name: "Sso" });
  const authorized = await fetch(started.body.url, { redirect: "manual" });
  const back = new URL(authorized.headers.get("location")!);
  const landed = await client.call(back.pathname + back.search);
  const current = await client.call<{ user: { id: string } } | null>(
    "/api/auth/get-session",
  );
  return { client, landed, userId: current.body?.user.id };
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

const userByEmail = (email: string) =>
  withoutOrg(environment, "test", (tx) =>
    tx.select().from(user).where(eq(user.email, email)),
  );

describe("SSO settings", () => {
  it("are locked on plans without SSO, and open on Internal", async () => {
    const onTeam = await organization(team);
    const read = await settings(onTeam.owner.client, onTeam.org);
    expect(read.body).toMatchObject({
      access: {
        available: false,
        reason: "plan",
        licenseExpiredAt: null,
        canEdit: false,
        role: "owner",
      },
      connection: null,
      domains: [],
    });
    const refused = await onTeam.owner.client.call(
      `/v1/orgs/${onTeam.org}/sso`,
      { method: "PUT", body: oidc() },
    );
    expect(refused.status).toBe(403);
    expect(
      (await addDomain(onTeam.owner.client, onTeam.org, onTeam.domain)).status,
    ).toBe(403);

    const onInternal = await organization();
    const saved = await onInternal.owner.client.call<Connection>(
      `/v1/orgs/${onInternal.org}/sso`,
      { method: "PUT", body: oidc() },
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      protocol: "oidc",
      saml: null,
      oidc: { issuer: IDP, clientId: "preprocess", hasSecret: true },
      lastTest: null,
      requireSso: false,
      jit: true,
      defaultGroupId: null,
    });
    const internalRead = await settings(
      onInternal.owner.client,
      onInternal.org,
    );
    expect(internalRead.body.access).toMatchObject({
      available: true,
      canEdit: true,
    });
    // The values the IdP needs exist before any connection, per organization.
    expect(internalRead.body.serviceProvider).toEqual({
      acsUrl: expect.stringContaining(
        `/api/auth/sso/saml2/sp/acs/${onInternal.org}`,
      ) as string,
      entityId: expect.stringContaining(
        `/api/auth/sso/saml2/sp/metadata?providerId=${onInternal.org}`,
      ) as string,
      redirectUri: expect.stringContaining(
        `/api/auth/sso/callback/${onInternal.org}`,
      ) as string,
    });
    // The secret never comes back.
    expect(JSON.stringify(saved.body)).not.toContain("shh");
    expect(JSON.stringify(internalRead.body)).not.toContain("shh");
    expect(await events(onInternal.org, "sso.connection.created")).toHaveLength(
      1,
    );
  });

  it("are read by Owners and Admins, changed only by Owners, and never reach another organization", async () => {
    const { org, owner, domain } = await organization();
    const admin = await addMember(owner.client, org, "Ada Admin", "admin");
    const plain = await addMember(owner.client, org, "Mo Member");
    const asAdmin = await settings(admin.client, org);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.access).toMatchObject({
      available: true,
      canEdit: false,
      role: "admin",
    });
    expect((await settings(plain.client, org)).status).toBe(403);
    for (const [path, method, body] of [
      [`/v1/orgs/${org}/sso`, "PUT", oidc()],
      [`/v1/orgs/${org}/sso`, "DELETE", undefined],
      [`/v1/orgs/${org}/sso/domains`, "POST", { domain }],
      [`/v1/orgs/${org}/sso/sign-in`, "PATCH", { jit: false }],
      [`/v1/orgs/${org}/sso/test`, "GET", undefined],
    ] as const) {
      expect((await admin.client.call(path, { method, body })).status).toBe(
        403,
      );
      expect((await plain.client.call(path, { method, body })).status).toBe(
        403,
      );
    }
    const other = await organization();
    expect((await settings(other.owner.client, org)).status).toBe(403);
    // The plugin's own management routes are off; routes/sso.ts is the way.
    expect(
      (
        await owner.client.call("/api/auth/sso/register", {
          body: { providerId: "x", issuer: IDP, domain, organizationId: org },
        })
      ).status,
    ).toBe(404);
  });

  it("read SAML metadata from its URL, with the certificate's expiry", async () => {
    const { org, owner } = await organization();
    const saved = await owner.client.call<Connection>(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: { protocol: "saml", metadataUrl: `${IDP}/saml/metadata` },
    });
    expect(saved.status).toBe(200);
    const saml = saved.body.saml!;
    expect(saml).toMatchObject({
      metadataUrl: `${IDP}/saml/metadata`,
      pastedXml: false,
      idpEntityId: SAML_ENTITY,
    });
    expect(Date.parse(saml.metadataReadAt!)).toBeGreaterThan(
      Date.now() - 60_000,
    );
    // The fake IdP's certificate lasts a day.
    expect(Date.parse(saml.certificateExpiresAt!)).toBeGreaterThan(Date.now());
    expect(Date.parse(saml.certificateExpiresAt!)).toBeLessThan(
      Date.now() + 2 * day,
    );

    const xml = await (await fetch(`${IDP}/saml/metadata`)).text();
    const pasted = await owner.client.call<Connection>(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: { protocol: "saml", metadataXml: xml },
    });
    expect(pasted.body.saml).toMatchObject({
      metadataUrl: null,
      pastedXml: true,
    });

    const missing = await owner.client.call<{
      error: { code: string; message: string; status: string };
    }>(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: { protocol: "saml", metadataUrl: `${IDP}/saml/missing` },
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toEqual({
      code: "metadata_unreadable",
      message: "Couldn't read the metadata: the URL returned 404 Not Found.",
      status: "404 Not Found",
    });
    // #217's validation errors keep their shape on PUT.
    const plain = await owner.client.call<unknown>(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: { protocol: "saml", metadataUrl: "http://idp.test/x" },
    });
    expect(plain.status).toBe(400);
    expect(plain.body).toMatchObject({ success: false });
    expect(JSON.stringify(plain.body)).toContain("Use an https:// URL.");
    // A connection can't switch protocols in place.
    const switched = await owner.client.call<{ error: string }>(
      `/v1/orgs/${org}/sso`,
      { method: "PUT", body: oidc() },
    );
    expect(switched.status).toBe(409);
    expect(switched.body.error).toBe(
      "Remove the connection before switching between SAML and OIDC.",
    );
  });
});

describe("SSO domains", () => {
  it("verify by their TXT record, one organization per domain", async () => {
    const { org, owner, domain } = await organization();
    const added = await addDomain(owner.client, org, domain);
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({
      domain,
      status: "pending",
      failureReason: null,
      record: {
        type: "TXT",
        name: `_preprocess.${domain}`,
        value: expect.stringMatching(/^preprocess-verification=\w+$/) as string,
      },
    });
    expect(added.body.checkedAt).not.toBeNull();
    expect((await addDomain(owner.client, org, domain)).body.error?.code).toBe(
      "domain_exists",
    );
    // A connection exists, but nobody signs in through an unverified domain.
    await owner.client.call(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: oidc(),
    });
    expect((await ssoSignIn(`sam@${domain}`)).userId).toBeUndefined();

    // A different value fails at once.
    await publish(added.body.record.name, "preprocess-verification=wrong");
    const wrong = await checkDomain(owner.client, org, domain);
    expect(wrong.body).toMatchObject({
      status: "failed",
      failureReason: "value_mismatch",
    });
    await publish(added.body.record.name, added.body.record.value);
    const verified = await checkDomain(owner.client, org, domain);
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({
      status: "verified",
      failureReason: null,
    });
    expect(await events(org, "sso.domain.verified")).toHaveLength(1);
    expect((await ssoSignIn(`sam@${domain}`)).userId).toBeDefined();

    // Another organization can't claim it.
    const other = await organization();
    expect(
      (await addDomain(other.owner.client, other.org, domain)).body.error?.code,
    ).toBe("domain_taken");

    // Removed, it signs nobody in.
    const removed = await owner.client.call(
      `/v1/orgs/${org}/sso/domains/${domain}`,
      { method: "DELETE" },
    );
    expect(removed.status).toBe(204);
    expect((await settings(owner.client, org)).body.domains).toEqual([]);
    expect((await ssoSignIn(`sue@${domain}`)).userId).toBeUndefined();
    expect(await events(org, "sso.domain.removed")).toHaveLength(1);
  });

  it("stay pending for a day while the record is missing, then fail", async () => {
    const { org, owner } = await organization();
    const domain = `${unique("later")}.test`;
    const added = await addDomain(owner.client, org, domain);
    expect(added.body.status).toBe("pending");
    expect((await checkDomain(owner.client, org, domain)).body.status).toBe(
      "pending",
    );
    await withoutOrg(environment, "test", (tx) =>
      tx
        .update(ssoDomains)
        .set({ createdAt: new Date(Date.now() - 2 * day) })
        .where(
          and(
            eq(ssoDomains.organizationId, org),
            eq(ssoDomains.domain, domain),
          ),
        ),
    );
    const checked = await checkDomain(owner.client, org, domain);
    expect(checked.body).toMatchObject({
      status: "failed",
      failureReason: "record_missing",
    });
  });
});

describe("SSO test sign-in", () => {
  it("passes over OIDC, records who and as whom, and signs nobody in", async () => {
    const { org, owner, domain } = await organization();
    await owner.client.call(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: oidc(),
    });
    // Before any domain is verified, and for someone who isn't a member yet.
    const email = `tess@${domain}`;
    const { popup, landed } = await testSignIn(owner.client, org, {
      sub: email,
      email,
    });
    expect(landed.status).toBe(200);
    expect(landed.body).toContain("preprocess:sso-test");
    expect(
      (await popup.call<unknown>("/api/auth/get-session")).body,
    ).toBeNull();
    expect(await userByEmail(email)).toHaveLength(0);
    const read = await settings(owner.client, org);
    expect(read.body.connection!.lastTest).toEqual({
      ok: true,
      at: expect.any(String) as string,
      by: { id: owner.userId, name: "Olive Owner" },
      email,
    });
    expect(await events(org, "sso.test.passed")).toHaveLength(1);
    // The Owner is still signed in as themselves.
    expect((await settings(owner.client, org)).status).toBe(200);
  });

  it("fails with the reason when the IdP refuses the person", async () => {
    const { org, owner } = await organization();
    await owner.client.call(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: oidc(),
    });
    await testSignIn(owner.client, org, {
      sub: "x",
      email: "x@example.test",
      deny: "User is not assigned to the client application.",
    });
    const read = await settings(owner.client, org);
    expect(read.body.connection!.lastTest).toMatchObject({
      ok: false,
      reason: "user_not_assigned",
      idpMessage: expect.stringContaining("not assigned") as string,
    });
    expect(await events(org, "sso.test.failed")).toHaveLength(1);
  });

  it("fails as an audience mismatch over SAML", async () => {
    const { org, owner, domain } = await organization();
    const certificate = await (await fetch(`${IDP}/saml/cert`)).text();
    await owner.client.call(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: {
        protocol: "saml",
        idpEntityId: SAML_ENTITY,
        ssoUrl: SAML_SSO_URL,
        certificate,
      },
    });
    const popup = new Client(environment);
    popup.cookie = owner.client.cookie;
    const started = await popup.call(`/v1/orgs/${org}/sso/test`);
    expect(started.status).toBe(302);
    const email = `sal@${domain}`;
    await next({ sub: email, email, audience: "https://elsewhere.test/sp" });
    const answer = await (
      await fetch(started.headers.get("location")!)
    ).json<SamlAnswer>();
    const landed = await popup.call<string>(new URL(answer.acs).pathname, {
      form: {
        SAMLResponse: answer.SAMLResponse,
        RelayState: answer.RelayState,
      },
    });
    expect(landed.body).toContain("preprocess:sso-test");
    const read = await settings(owner.client, org);
    expect(read.body.connection!.lastTest).toMatchObject({
      ok: false,
      reason: "audience_mismatch",
      idpMessage: `Audience mismatch. Expected ${read.body.serviceProvider.entityId}`,
    });
  });
});

describe("SSO sign-in", () => {
  it("adds a new person to the organization and its default group with JIT, audited", async () => {
    const { org, owner, domain } = await organization();
    await connect(owner.client, org, domain);
    const group = await owner.client.call<{ id: string }>(
      `/v1/orgs/${org}/groups`,
      { body: { name: "Operators" } },
    );
    const chosen = await signIn(owner.client, org, {
      defaultGroupId: group.body.id,
    });
    expect(chosen.body.connection!.defaultGroupId).toBe(group.body.id);
    expect(
      (await signIn(owner.client, org, { defaultGroupId: "grp_nope" })).status,
    ).toBe(400);
    const { landed, userId } = await ssoSignIn(`sam@${domain}`);
    expect(landed.status).toBe(302);
    expect(userId).toBeDefined();
    expect(await isMember(org, userId!)).toBe(true);
    const added = await events(org, "member.added");
    expect(added.find((e) => e.targetId === userId)).toMatchObject({
      actorType: "platform",
      actorId: "platform:sso",
    });
    const inGroup = await withoutOrg(environment, "test", (tx) =>
      tx
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, group.body.id),
            eq(groupMembers.userId, userId!),
          ),
        ),
    );
    expect(inGroup).toHaveLength(1);
  });

  it("with JIT off, takes only members and invited people", async () => {
    const { org, owner, domain } = await organization();
    await connect(owner.client, org, domain);
    expect(
      (await signIn(owner.client, org, { jit: false })).body.connection!.jit,
    ).toBe(false);
    const stranger = await ssoSignIn(`stranger@${domain}`);
    expect(stranger.userId).toBeUndefined();
    expect(await userByEmail(`stranger@${domain}`)).toHaveLength(0);

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

  it("is required only after a verified domain and a passed test, then ends other sessions, except Owners'", async () => {
    const { org, owner, domain } = await organization();
    const jo = await signUp("Jo Member", environment, `jo@${domain}`);
    await owner.client.call(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: oidc(),
    });
    const early = await signIn(owner.client, org, { requireSso: true });
    expect(early.status).toBe(409);
    expect(early.body.error?.code).toBe("sso_not_ready");
    await verify(owner.client, org, domain);
    expect((await signIn(owner.client, org, { requireSso: true })).status).toBe(
      409,
    );
    await testSignIn(owner.client, org, {
      sub: `olive@${domain}`,
      email: `olive@${domain}`,
    });
    // Someone signed in through SSO keeps their session.
    const sso = await ssoSignIn(`sam@${domain}`);
    const required = await signIn(owner.client, org, { requireSso: true });
    expect(required.status).toBe(200);
    expect(required.body.connection!.requireSso).toBe(true);
    const [updated] = await events(org, "sso.sign_in.updated");
    expect(updated?.data).toMatchObject({
      from: { requireSso: false },
      to: { requireSso: true },
      endedSessions: 1,
    });
    // Jo's email-link session is over; the Owner's and the SSO one aren't.
    expect(
      (await jo.client.call<unknown>("/api/auth/get-session")).body,
    ).toBeNull();
    expect((await settings(owner.client, org)).status).toBe(200);
    expect(
      (await sso.client.call<{ user: unknown } | null>("/api/auth/get-session"))
        .body,
    ).not.toBeNull();
    const sessions = await withoutOrg(environment, "test", (tx) =>
      tx.select().from(session).where(eq(session.userId, sso.userId!)),
    );
    expect(sessions.every((s) => s.signInMethod === "sso")).toBe(true);

    // Email links are off at the domain now, except for Owners.
    const byLink = await signInByLink(new Client(environment), `jo@${domain}`);
    expect(byLink.status).toBe(403);
    expect(JSON.stringify(byLink.body)).toContain("SSO_REQUIRED");
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
    expect((await ssoSignIn(`jo@${domain}`)).userId).toBe(jo.userId);

    // Removing the last verified domain turns it off.
    await owner.client.call(`/v1/orgs/${org}/sso/domains/${domain}`, {
      method: "DELETE",
    });
    expect(
      (await settings(owner.client, org)).body.connection!.requireSso,
    ).toBe(false);
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
    const read = await settings(owner.client, org);
    expect(read.body.access).toMatchObject({
      available: false,
      reason: "plan",
      canEdit: false,
    });
    expect(read.body.domains[0]?.status).toBe("verified");
    for (const [path, method, body] of [
      [`/v1/orgs/${org}/sso`, "PUT", oidc()],
      [`/v1/orgs/${org}/sso`, "DELETE", undefined],
      [`/v1/orgs/${org}/sso/sign-in`, "PATCH", { jit: false }],
      [`/v1/orgs/${org}/sso/domains/${domain}/check`, "POST", undefined],
      [`/v1/orgs/${org}/sso/domains/${domain}`, "DELETE", undefined],
    ] as const)
      expect((await owner.client.call(path, { method, body })).status).toBe(
        403,
      );
    clock.mockRestore();
  });

  it("keeps working on a self-hosted install past its license's grace, read-only, and locks a license without SSO", async () => {
    const { org, owner, domain } = await organization();
    await connect(owner.client, org, domain);
    const expiresAt = new Date(Date.now() - 40 * day);
    const expired = selfHosted(await license(["sso"], expiresAt));
    const as = (client: Client, env: Env) => {
      const copy = new Client(env);
      copy.cookie = client.cookie;
      return copy;
    };
    const read = await settings(as(owner.client, expired), org);
    expect(read.status).toBe(200);
    expect(read.body.access).toEqual({
      available: false,
      reason: "license_expired",
      licenseExpiredAt: new Date(expiresAt.getTime() + 30 * day).toISOString(),
      canEdit: false,
      role: "owner",
    });
    expect(read.body.connection?.protocol).toBe("oidc");
    expect(
      (
        await as(owner.client, expired).call(`/v1/orgs/${org}/sso/sign-in`, {
          method: "PATCH",
          body: { jit: false },
        })
      ).status,
    ).toBe(403);
    const { userId } = await ssoSignIn(`exp@${domain}`, undefined, expired);
    expect(userId).toBeDefined();

    const withoutSso = selfHosted(
      await license(["audit_export"], new Date(Date.now() + 100 * day)),
    );
    expect(
      (await settings(as(owner.client, withoutSso), org)).body.access,
    ).toMatchObject({ available: false, reason: "license_missing" });
    const active = selfHosted(
      await license(["sso"], new Date(Date.now() + 100 * day)),
    );
    expect(
      (await settings(as(owner.client, active), org)).body.access,
    ).toMatchObject({ available: true, canEdit: true });
  });

  it("works over SAML, signed by the IdP's certificate", async () => {
    const { org, owner, domain } = await organization();
    const certificate = await (await fetch(`${IDP}/saml/cert`)).text();
    const saved = await owner.client.call<Connection>(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: {
        protocol: "saml",
        idpEntityId: SAML_ENTITY,
        ssoUrl: SAML_SSO_URL,
        certificate,
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.saml!.certificateExpiresAt).not.toBeNull();
    await verify(owner.client, org, domain);

    const client = new Client(environment);
    const email = `sal@${domain}`;
    const started = await client.call<{ url: string }>(
      "/api/auth/sign-in/sso",
      { body: { email, callbackURL: "/" } },
    );
    expect(started.status).toBe(200);
    await next({ sub: email, email });
    const answer = await (await fetch(started.body.url)).json<SamlAnswer>();
    const acs = new URL(answer.acs);
    const landed = await client.call(acs.pathname, {
      form: {
        SAMLResponse: answer.SAMLResponse,
        RelayState: answer.RelayState,
      },
    });
    expect(landed.status).toBe(302);
    const current = await client.call<{
      user: { id: string; email: string };
    } | null>("/api/auth/get-session");
    expect(current.body?.user.email).toBe(email);
    expect(await isMember(org, current.body!.user.id)).toBe(true);

    // An assertion changed after the IdP signed it signs nobody in.
    const mallory = new Client(environment);
    const again = await mallory.call<{ url: string }>("/api/auth/sign-in/sso", {
      body: { email: `mallory@${domain}`, callbackURL: "/" },
    });
    await next({ sub: "m", email: `mallory@${domain}` });
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

  it("is audited when the connection changes or goes away, and keeps the domains", async () => {
    const { org, owner, domain } = await organization();
    await connect(owner.client, org, domain);
    const changed = await owner.client.call<Connection>(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: oidc({ clientSecret: undefined, clientId: "renamed" }),
    });
    expect(changed.status).toBe(200);
    expect(changed.body.oidc).toEqual({
      issuer: IDP,
      clientId: "renamed",
      hasSecret: true,
    });
    const [updated] = await events(org, "sso.connection.updated");
    expect(updated?.data).toMatchObject({
      clientId: "renamed",
      secretChanged: false,
    });
    const removed = await owner.client.call(`/v1/orgs/${org}/sso`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
    expect(await events(org, "sso.connection.deleted")).toHaveLength(1);
    const read = await settings(owner.client, org);
    expect(read.body.connection).toBeNull();
    expect(read.body.domains.map((d) => d.domain)).toEqual([domain]);
  });
});

// #217's /v1 shapes, deprecated and kept working (CONTRIBUTING.md): domains,
// enforced and jit on PUT /sso, POST /sso/verify-domain, and the connection's
// fields as #217 answered them.
describe("SSO settings through #217's deprecated fields", () => {
  const legacy = (domain: string, extra: object = {}) =>
    oidc({ domains: [domain], ...extra });

  const legacyConnect = async (
    owner: Client,
    org: string,
    domain: string,
    extra: object = {},
  ) => {
    const saved = await owner.call<Connection>(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: legacy(domain, extra),
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

  it("are refused on plans without SSO, and allowed on Internal", async () => {
    const onTeam = await organization(team);
    const read = await settings(onTeam.owner.client, onTeam.org);
    expect(read.body).toMatchObject({ allowed: false, connection: null });
    const refused = await onTeam.owner.client.call(
      `/v1/orgs/${onTeam.org}/sso`,
      { method: "PUT", body: legacy(onTeam.domain) },
    );
    expect(refused.status).toBe(403);

    const onInternal = await organization();
    const saved = await onInternal.owner.client.call<Connection>(
      `/v1/orgs/${onInternal.org}/sso`,
      { method: "PUT", body: legacy(onInternal.domain) },
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
    expect(
      (await settings(onInternal.owner.client, onInternal.org)).body.allowed,
    ).toBe(true);
    expect(await events(onInternal.org, "sso.connection.created")).toHaveLength(
      1,
    );
  });

  it("are changed by Owners only, and never reach another organization", async () => {
    const { org, owner, domain } = await organization();
    const admin = await addMember(owner.client, org, "Ada Admin", "admin");
    // Admins read the settings now; changing them stays the Owners'.
    expect((await admin.client.call(`/v1/orgs/${org}/sso`)).status).toBe(200);
    for (const [path, method, body] of [
      [`/v1/orgs/${org}/sso`, "PUT", legacy(domain)],
      [`/v1/orgs/${org}/sso/verify-domain`, "POST", undefined],
    ] as const)
      expect((await admin.client.call(path, { method, body })).status).toBe(
        403,
      );
    const other = await organization();
    expect((await other.owner.client.call(`/v1/orgs/${org}/sso`)).status).toBe(
      403,
    );
  });

  it("verify the domains by their DNS TXT record", async () => {
    const { org, owner, domain } = await organization();
    const second = `${unique("acme")}.test`;
    const saved = await owner.client.call<Connection>(`/v1/orgs/${org}/sso`, {
      method: "PUT",
      body: legacy(domain, { domains: [domain, second] }),
    });
    const record = saved.body.verification!;
    expect(record.name).toBe("_preprocess");
    const early = await owner.client.call(`/v1/orgs/${org}/sso/verify-domain`, {
      method: "POST",
    });
    expect(early.status).toBe(409);
    // Nobody signs in through an unverified domain.
    const refused = await new Client(environment).call(
      "/api/auth/sign-in/sso",
      {
        body: { email: `sam@${domain}`, callbackURL: "/" },
      },
    );
    expect(refused.status).toBeGreaterThanOrEqual(400);

    // One record, published at each domain, proves them all.
    await publish(`${record.name}.${domain}`, record.value);
    await publish(`${record.name}.${second}`, record.value);
    const verified = await owner.client.call<Connection>(
      `/v1/orgs/${org}/sso/verify-domain`,
      { method: "POST" },
    );
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({
      domains: [domain, second],
      domainVerified: true,
      verification: null,
    });
    expect(await events(org, "sso.domain.verified")).toHaveLength(2);

    // The list replaces the organization's domains.
    const narrowed = await owner.client.call<Connection>(
      `/v1/orgs/${org}/sso`,
      {
        method: "PUT",
        body: legacy(second, { clientSecret: undefined }),
      },
    );
    expect(narrowed.body.domains).toEqual([second]);
    expect((await settings(owner.client, org)).body.domains).toMatchObject([
      { domain: second, status: "verified" },
    ]);
  });

  it("add a new person with JIT, or with JIT off take only members and invited people", async () => {
    const { org, owner, domain } = await organization();
    await legacyConnect(owner.client, org, domain);
    const sam = await ssoSignIn(`sam@${domain}`);
    expect(sam.userId).toBeDefined();
    expect(await isMember(org, sam.userId!)).toBe(true);

    const off = await organization();
    await legacyConnect(off.owner.client, off.org, off.domain, { jit: false });
    expect(
      (await settings(off.owner.client, off.org)).body.connection!.jit,
    ).toBe(false);
    const stranger = await ssoSignIn(`stranger@${off.domain}`);
    expect(stranger.userId).toBeUndefined();
  });

  it("once enforced, turn other sign-in off at the domain, except for Owners", async () => {
    const { org, owner, domain } = await organization();
    await signUp("Jo Member", environment, `jo@${domain}`);
    await legacyConnect(owner.client, org, domain);
    // Enforcing now needs a passed test sign-in, as Require SSO does.
    const early = await owner.client.call<{ error: { code: string } }>(
      `/v1/orgs/${org}/sso`,
      {
        method: "PUT",
        body: legacy(domain, { clientSecret: undefined, enforced: true }),
      },
    );
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("sso_not_ready");
    await testSignIn(owner.client, org, {
      sub: `olive@${domain}`,
      email: `olive@${domain}`,
    });
    const enforced = await owner.client.call<Connection>(
      `/v1/orgs/${org}/sso`,
      {
        method: "PUT",
        body: legacy(domain, { clientSecret: undefined, enforced: true }),
      },
    );
    expect(enforced.status).toBe(200);
    // Saving the same connection again keeps its test.
    expect(enforced.body).toMatchObject({
      enforced: true,
      requireSso: true,
      lastTest: { ok: true },
    });
    const byLink = await signInByLink(new Client(environment), `jo@${domain}`);
    expect(byLink.status).toBe(403);
    expect(JSON.stringify(byLink.body)).toContain("SSO_REQUIRED");
    expect(
      (await signInByLink(new Client(environment), `olive@${domain}`)).status,
    ).toBeLessThan(400);
    const [updated] = await events(org, "sso.sign_in.updated");
    expect(updated?.data).toMatchObject({
      from: { requireSso: false },
      to: { requireSso: true },
    });
  });

  it("keep working when the plan lapses, and turn read-only", async () => {
    const { org, owner, domain } = await organization();
    await legacyConnect(owner.client, org, domain);
    plans.set(org, team);
    const later = Date.now() + 60_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => later);
    const read = await settings(owner.client, org);
    expect(read.body.allowed).toBe(false);
    expect(read.body.connection).toMatchObject({ domainVerified: true });
    for (const [path, method] of [
      [`/v1/orgs/${org}/sso`, "PUT"],
      [`/v1/orgs/${org}/sso/verify-domain`, "POST"],
    ] as const)
      expect(
        (
          await owner.client.call(path, {
            method,
            body: method === "PUT" ? legacy(domain) : undefined,
          })
        ).status,
      ).toBe(403);
    clock.mockRestore();
  });

  it("answer verify-domain with 404 before a connection exists", async () => {
    const { org, owner } = await organization();
    const missing = await owner.client.call<{ error: string }>(
      `/v1/orgs/${org}/sso/verify-domain`,
      { method: "POST" },
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Set up a connection first.");
  });
});
