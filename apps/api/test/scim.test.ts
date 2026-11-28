// Directory sync (PRE-138, spec 13 and 16): SCIM 2.0 through Better Auth's
// plugin at /api/auth/scim/v2. Owners issue and revoke tokens; a token
// provisions users and groups into its own organization only; deactivating
// ends every session and refuses sign-in; every SCIM write is audited; and
// SCIM stops when the plan has no scim.

import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents, groups } from "@preprocess/db/schema/access";
import { auditEvents } from "@preprocess/db/schema/audit";
import { member, scimUser, session, user } from "@preprocess/db/schema/auth";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env.ts";
import worker from "../src/index.ts";
import { licenseKeys } from "../src/license.ts";
import {
  addMember,
  Client,
  createOrganization,
  signInByLink,
  signUp,
  testEnv,
  unique,
} from "./helpers.ts";

const PATCH_OP = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
const LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
const day = 86_400_000;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

let signing: CryptoKeyPair;
let signingPublic: string;
let licensed: Env;

const license = async (features: string[]) => {
  const now = Date.now();
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      kid: "test-only",
      customer: "Directory Corp",
      features,
      seats: 100,
      issuedAt: new Date(now - day).toISOString(),
      expiresAt: new Date(now + 364 * day).toISOString(),
    }),
  );
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    signing.privateKey,
    bytes,
  );
  return `${base64url(bytes)}.${base64url(new Uint8Array(signature))}`;
};

type Scim = {
  status: number;
  body: Record<string, unknown> & {
    id?: string;
    Resources?: Record<string, unknown>[];
    totalResults?: number;
  };
  headers: Headers;
};

// An identity provider calling SCIM with a bearer token.
const scim = async (
  environment: Env,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Scim> => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(new URL(`/api/auth/scim/v2${path}`, environment.APP_URL), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/scim+json",
        ...(body === undefined
          ? {}
          : { "content-type": "application/scim+json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    environment,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Scim["body"]) : {},
    headers: response.headers,
  };
};

const asEnv = (client: Client, environment: Env) => {
  const copy = new Client(environment);
  copy.cookie = client.cookie;
  return copy;
};

// An Owner on a licensed install with an organization and a SCIM token.
const directory = async (name: string, environment = licensed) => {
  const owner = await signUp(`${name} Owner`);
  const org = await createOrganization(owner.client, name);
  const client = asEnv(owner.client, environment);
  const issued = await client.call<{ token: string; prefix: string }>(
    `/v1/orgs/${org}/scim/tokens`,
    { body: {} },
  );
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  return { owner: { ...owner, client }, org, token: issued.body.token };
};

const newUser = (name: string, extra: Record<string, unknown> = {}) => {
  const userName = `${unique(name.toLowerCase())}@directory.test`;
  return {
    schemas: [USER],
    userName,
    externalId: unique("ext"),
    name: { givenName: name, familyName: "Synced" },
    emails: [{ value: userName, type: "work", primary: true }],
    active: true,
    ...extra,
  };
};

const events = (org: string) =>
  withoutOrg(licensed, "test: audit", (tx) =>
    tx
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, org))
      .orderBy(asc(auditEvents.seq)),
  );

const userRow = async (userId: string) => {
  const [row] = await withoutOrg(licensed, "test: user", (tx) =>
    tx.select().from(user).where(eq(user.id, userId)),
  );
  return row!;
};

const membership = async (org: string, userId: string) => {
  const [row] = await withoutOrg(licensed, "test: member", (tx) =>
    tx
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, org), eq(member.userId, userId))),
  );
  return row;
};

// The Better Auth user a SCIM User provisioned.
const linkedUser = async (scimId: string) => {
  const [row] = await withoutOrg(licensed, "test: scim user", (tx) =>
    tx
      .select({ userId: scimUser.userId })
      .from(scimUser)
      .where(eq(scimUser.id, scimId)),
  );
  return row!.userId;
};

const sessions = (userId: string) =>
  withoutOrg(licensed, "test: sessions", (tx) =>
    tx
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userId)),
  );

beforeAll(async () => {
  signing = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  signingPublic = base64url(
    new Uint8Array(
      (await crypto.subtle.exportKey("raw", signing.publicKey)) as ArrayBuffer,
    ),
  );
  licenseKeys.push(signingPublic);
  licensed = testEnv({
    PREPROCESS_REGION: undefined,
    PREPROCESS_LICENSE_KEY: await license(["scim", "synced_groups"]),
  } as unknown as Partial<Env>);
});

afterAll(() => {
  licenseKeys.splice(licenseKeys.indexOf(signingPublic), 1);
  vi.restoreAllMocks();
});

describe("directory sync tokens", () => {
  it("are issued once, listed without the secret, and refused once revoked", async () => {
    const { owner, org, token } = await directory("Tokenco");
    const [prefix] = token.split(".");
    expect(prefix).toMatch(/^ba_scim_credential_/);

    const status = await owner.client.call<{
      allowed: boolean;
      baseUrl: string;
      connection: { id: string } | null;
      tokens: { prefix: string; status: string; lastUsedAt: string | null }[];
    }>(`/v1/orgs/${org}/scim`);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      allowed: true,
      baseUrl: new URL("/api/auth/scim/v2", licensed.APP_URL).toString(),
      tokens: [{ prefix, status: "active", lastUsedAt: null }],
    });
    expect(status.body.connection?.id).toMatch(/^ba_scim_connection_/);
    expect(JSON.stringify(status.body)).not.toContain(token);

    expect((await scim(licensed, token, "GET", "/Users")).status).toBe(200);
    const used = await owner.client.call<{
      tokens: { lastUsedAt: string | null }[];
    }>(`/v1/orgs/${org}/scim`);
    expect(used.body.tokens[0]?.lastUsedAt).not.toBeNull();

    const second = await owner.client.call<{ token: string; prefix: string }>(
      `/v1/orgs/${org}/scim/tokens`,
      { body: { expiresInDays: 30 } },
    );
    expect(second.status).toBe(201);

    const revoked = await owner.client.call(
      `/v1/orgs/${org}/scim/tokens/${prefix}`,
      { method: "DELETE" },
    );
    expect(revoked.status).toBe(204);
    const refused = await scim(licensed, token, "GET", "/Users");
    expect(refused.status).toBe(401);
    expect(refused.body.schemas).toEqual([ERROR]);
    expect(
      (await scim(licensed, second.body.token, "GET", "/Users")).status,
    ).toBe(200);

    const after = await owner.client.call<{
      tokens: { prefix: string; status: string }[];
    }>(`/v1/orgs/${org}/scim`);
    expect(after.body.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prefix, status: "revoked" }),
        expect.objectContaining({
          prefix: second.body.prefix,
          status: "active",
        }),
      ]),
    );
    expect(
      (
        await owner.client.call(
          `/v1/orgs/${org}/scim/tokens/ba_scim_credential_nope`,
          {
            method: "DELETE",
          },
        )
      ).status,
    ).toBe(404);

    const audited = (await events(org)).filter((e) =>
      e.action.startsWith("scim.token."),
    );
    expect(
      audited.map((e) => [e.action, e.actorType, e.actorId, e.targetId]),
    ).toEqual([
      ["scim.token.created", "person", owner.userId, prefix],
      ["scim.token.created", "person", owner.userId, second.body.prefix],
      ["scim.token.revoked", "person", owner.userId, prefix],
    ]);
  });

  it("are for Owners only, and five at a time", async () => {
    const { owner, org } = await directory("Ownerco");
    const admin = await addMember(owner.client, org, "Token Admin", "admin");
    const adminClient = asEnv(admin.client, licensed);
    for (const call of [
      adminClient.call(`/v1/orgs/${org}/scim`),
      adminClient.call(`/v1/orgs/${org}/scim/tokens`, { body: {} }),
    ]) {
      const refused = await call;
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({
        error: "Only Owners can manage directory sync.",
      });
    }
    for (let n = 1; n < 5; n++)
      expect(
        (await owner.client.call(`/v1/orgs/${org}/scim/tokens`, { body: {} }))
          .status,
      ).toBe(201);
    const sixth = await owner.client.call(`/v1/orgs/${org}/scim/tokens`, {
      body: {},
    });
    expect(sixth.status).toBe(409);
    expect(sixth.body).toMatchObject({
      error:
        "An organization can have 5 directory sync tokens at a time. Revoke one first.",
    });
  });
});

describe("plans", () => {
  it("refuse tokens and SCIM where the plan has no scim, and keep the data", async () => {
    const { owner, org, token } = await directory("Lapseco");
    const created = await scim(
      licensed,
      token,
      "POST",
      "/Users",
      newUser("Kept"),
    );
    expect(created.status).toBe(201);

    // The license lapses: the install is on the free plan.
    const free = testEnv({
      PREPROCESS_REGION: undefined,
    } as unknown as Partial<Env>);
    const refused = await scim(free, token, "GET", "/Users");
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({
      schemas: [ERROR],
      status: "403",
      detail: "Directory sync isn't included in this organization's plan.",
    });
    expect(refused.headers.get("content-type")).toBe("application/scim+json");
    const issue = await asEnv(owner.client, free).call(
      `/v1/orgs/${org}/scim/tokens`,
      { body: {} },
    );
    expect(issue.status).toBe(403);
    const status = await asEnv(owner.client, free).call<{
      allowed: boolean;
      tokens: unknown[];
    }>(`/v1/orgs/${org}/scim`);
    expect(status.body).toMatchObject({ allowed: false });
    expect(status.body.tokens).toHaveLength(1);

    // Back on a licensed plan, the same token and user are there.
    const back = await scim(
      licensed,
      token,
      "GET",
      `/Users/${created.body.id}`,
    );
    expect(back.status).toBe(200);
  });

  it("allow Enterprise and Internal on our cloud, and refuse Free", async () => {
    let flags: Record<string, unknown> = {};
    let planId = "free";
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname !== "api.useautumn.com")
        throw new Error(`unexpected fetch to ${url.hostname}`);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "customer",
            subscriptions: [{ plan_id: planId, status: "active" }],
            flags,
            balances: {},
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    });
    try {
      flags = { scim: {}, synced_groups: {} };
      planId = "enterprise";
      const cloud = testEnv({ AUTUMN_SECRET_KEY: "am_sk_test_stub" });
      const enterprise = await directory("Enterpriseco", cloud);
      expect(
        (await scim(cloud, enterprise.token, "GET", "/Users")).status,
      ).toBe(200);

      const ours = await signUp("Internal Owner");
      const internalOrg = await createOrganization(ours.client, "Internalco");
      planId = "internal";
      const internalEnv = testEnv({
        AUTUMN_SECRET_KEY: "am_sk_test_stub",
        BILLING_INTERNAL_ORGS: internalOrg,
      });
      const issued = await asEnv(ours.client, internalEnv).call<{
        token: string;
      }>(`/v1/orgs/${internalOrg}/scim/tokens`, { body: {} });
      expect(issued.status).toBe(201);
      expect(
        (await scim(internalEnv, issued.body.token, "GET", "/Users")).status,
      ).toBe(200);

      flags = {};
      planId = "free";
      const freeOwner = await signUp("Free Owner");
      const freeOrg = await createOrganization(freeOwner.client, "Freeco");
      const refused = await asEnv(freeOwner.client, cloud).call(
        `/v1/orgs/${freeOrg}/scim/tokens`,
        { body: {} },
      );
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({
        error: "Directory sync isn't included in this organization's plan.",
      });
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("SCIM users", () => {
  it("provision a member, deactivate them out of every session, and bring them back", async () => {
    const { org, token } = await directory("Lifecycleco");
    const body = newUser("Grace");
    const created = await scim(licensed, token, "POST", "/Users", body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      userName: body.userName,
      active: true,
    });
    const id = created.body.id!;
    const userId = await linkedUser(id);
    expect(await membership(org, userId)).toEqual({ role: "member" });

    // They sign in, from the browser and the CLI alike (both are sessions).
    const browser = new Client(licensed);
    expect((await signInByLink(browser, body.userName)).status).toBeLessThan(
      400,
    );
    expect(
      (await browser.call<{ user: { id: string } }>("/api/auth/get-session"))
        .body.user.id,
    ).toBe(userId);
    expect((await sessions(userId)).length).toBeGreaterThan(0);

    // Okta deactivates with a value-only replace.
    const deactivated = await scim(licensed, token, "PATCH", `/Users/${id}`, {
      schemas: [PATCH_OP],
      Operations: [{ op: "replace", value: { active: false } }],
    });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.active).toBe(false);
    expect((await userRow(userId)).deactivatedAt).not.toBeNull();
    expect(await membership(org, userId)).toBeUndefined();
    expect(await sessions(userId)).toEqual([]);
    expect((await browser.call("/api/auth/get-session")).body).toBeNull();
    const again = new Client(licensed);
    await signInByLink(again, body.userName);
    expect((await again.call("/api/auth/get-session")).body).toBeNull();

    // Entra reactivates with a path and a string boolean.
    const reactivated = await scim(licensed, token, "PATCH", `/Users/${id}`, {
      schemas: [PATCH_OP],
      Operations: [{ op: "Replace", path: "active", value: "True" }],
    });
    expect(reactivated.status).toBe(200);
    expect((await userRow(userId)).deactivatedAt).toBeNull();
    expect(await membership(org, userId)).toEqual({ role: "member" });
    const back = new Client(licensed);
    await signInByLink(back, body.userName);
    expect((await back.call("/api/auth/get-session")).body).not.toBeNull();

    const renamed = await scim(licensed, token, "PUT", `/Users/${id}`, {
      ...body,
      displayName: "Grace Hopper",
    });
    expect(renamed.status).toBe(200);
    expect((await userRow(userId)).name).toBe("Grace Hopper");

    expect((await scim(licensed, token, "DELETE", `/Users/${id}`)).status).toBe(
      204,
    );
    expect((await scim(licensed, token, "GET", `/Users/${id}`)).status).toBe(
      404,
    );
    expect((await userRow(userId)).deactivatedAt).not.toBeNull();
    expect(await membership(org, userId)).toBeUndefined();
    expect(await sessions(userId)).toEqual([]);

    const actor = `scim:${token.split(".")[0]}`;
    const audited = (await events(org)).filter((e) => e.actorId === actor);
    expect(audited.map((e) => e.action)).toEqual([
      "member.added",
      "scim.user.provisioned",
      "member.removed",
      "scim.user.deactivated",
      "member.added",
      "scim.user.reactivated",
      "scim.user.updated",
      "member.removed",
      "scim.user.deleted",
    ]);
    expect(new Set(audited.map((e) => e.actorType))).toEqual(
      new Set(["platform"]),
    );
    expect(
      audited.find((e) => e.action === "scim.user.provisioned"),
    ).toMatchObject({
      targetType: "user",
      targetId: userId,
      data: { scimUser: id, active: true },
    });
  });

  it("take over an existing member, and leave people their other organizations", async () => {
    const { owner, org, token } = await directory("Linkco");
    const other = await signUp("Elsewhere Owner");
    const otherOrg = await createOrganization(other.client, "Elsewhere");
    const person = await addMember(owner.client, org, "Both Places");
    const invited = await other.client.call<{ id: string }>(
      "/api/auth/organization/invite-member",
      {
        body: { email: person.email, role: "member", organizationId: otherOrg },
      },
    );
    await person.client.call("/api/auth/organization/accept-invitation", {
      body: { invitationId: invited.body.id },
    });

    const linked = await scim(licensed, token, "POST", "/Users", {
      ...newUser("Both"),
      userName: person.email,
      emails: [{ value: person.email, primary: true }],
    });
    expect(linked.status).toBe(201);
    expect(await linkedUser(linked.body.id!)).toBe(person.userId);

    await scim(licensed, token, "PATCH", `/Users/${linked.body.id}`, {
      schemas: [PATCH_OP],
      Operations: [{ op: "replace", path: "active", value: false }],
    });
    expect(await membership(org, person.userId)).toBeUndefined();
    expect(await membership(otherOrg, person.userId)).toEqual({
      role: "member",
    });
    expect((await userRow(person.userId)).deactivatedAt).toBeNull();
    expect(await sessions(person.userId)).toEqual([]);

    // Someone outside the organization is never taken over by address.
    const stranger = await signUp("Stranger");
    const conflict = await scim(licensed, token, "POST", "/Users", {
      ...newUser("Stranger"),
      userName: stranger.email,
      emails: [{ value: stranger.email, primary: true }],
    });
    expect(conflict.status).toBe(409);
    expect(await membership(org, stranger.userId)).toBeUndefined();
  });

  it("filter and page", async () => {
    const { token } = await directory("Pageco");
    const made = [];
    for (const name of ["Ann", "Ben", "Cat"])
      made.push(
        (await scim(licensed, token, "POST", "/Users", newUser(name))).body,
      );
    const page = await scim(
      licensed,
      token,
      "GET",
      "/Users?startIndex=2&count=1",
    );
    expect(page.body).toMatchObject({
      schemas: [LIST],
      totalResults: 3,
      startIndex: 2,
      itemsPerPage: 1,
    });
    expect(page.body.Resources).toHaveLength(1);
    const byName = await scim(
      licensed,
      token,
      "GET",
      `/Users?filter=${encodeURIComponent(`userName eq "${String(made[1]!.userName)}"`)}`,
    );
    expect(byName.body.totalResults).toBe(1);
    expect(byName.body.Resources?.[0]?.id).toBe(made[1]!.id);
    const byExternal = await scim(
      licensed,
      token,
      "GET",
      `/Users?filter=${encodeURIComponent(`externalId eq "${String(made[2]!.externalId)}"`)}`,
    );
    expect(byExternal.body.Resources?.[0]?.id).toBe(made[2]!.id);
    const none = await scim(
      licensed,
      token,
      "GET",
      `/Users?filter=${encodeURIComponent('userName eq "nobody@directory.test"')}`,
    );
    expect(none.body).toMatchObject({ totalResults: 0, Resources: [] });
  });
});

describe("SCIM groups", () => {
  it("sync names and members into read-only groups, and mark a deleted one", async () => {
    const { owner, org, token } = await directory("Groupco");
    const ann = (await scim(licensed, token, "POST", "/Users", newUser("Ann")))
      .body;
    const ben = (await scim(licensed, token, "POST", "/Users", newUser("Ben")))
      .body;
    const annId = await linkedUser(ann.id!);
    const benId = await linkedUser(ben.id!);

    const created = await scim(licensed, token, "POST", "/Groups", {
      schemas: [GROUP],
      displayName: "Finance Team",
      members: [{ value: ann.id }],
    });
    expect(created.status).toBe(201);
    const scimGroupId = created.body.id!;
    const listed = await owner.client.call<
      {
        id: string;
        slug: string;
        name: string;
        memberCount: number;
        synced: boolean;
        syncedRemovedAt: string | null;
      }[]
    >(`/v1/orgs/${org}/groups`);
    const group = listed.body.find((g) => g.name === "Finance Team")!;
    expect(group).toMatchObject({
      slug: "finance-team",
      memberCount: 1,
      synced: true,
      syncedRemovedAt: null,
    });

    // Okta adds members; Entra removes with a value filter.
    expect(
      (
        await scim(licensed, token, "PATCH", `/Groups/${scimGroupId}`, {
          schemas: [PATCH_OP],
          Operations: [
            { op: "add", path: "members", value: [{ value: ben.id }] },
          ],
        })
      ).status,
    ).toBeLessThan(300);
    expect(
      (
        await scim(licensed, token, "PATCH", `/Groups/${scimGroupId}`, {
          schemas: [PATCH_OP],
          Operations: [
            { op: "Remove", path: `members[value eq "${ann.id}"]` },
            { op: "Replace", path: "displayName", value: "Finance" },
          ],
        })
      ).status,
    ).toBeLessThan(300);
    const detail = await owner.client.call<{
      slug: string;
      name: string;
      members: { userId: string }[];
    }>(`/v1/orgs/${org}/groups/${group.id}`);
    expect(detail.body).toMatchObject({
      slug: "finance-team",
      name: "Finance",
    });
    expect(detail.body.members.map((m) => m.userId)).toEqual([benId]);

    // Its name and members are the directory's; its access is ours.
    const rename = await owner.client.call(
      `/v1/orgs/${org}/groups/${group.id}`,
      {
        method: "PATCH",
        body: { name: "Money" },
      },
    );
    expect(rename.status).toBe(409);
    expect(rename.body).toMatchObject({
      error:
        "This group's name comes from your identity provider. Change it there.",
    });
    const join = await owner.client.call(
      `/v1/orgs/${org}/groups/${group.id}/members/${annId}`,
      { method: "PUT" },
    );
    expect(join.status).toBe(409);
    expect(join.body).toMatchObject({
      error:
        "This group's members come from your identity provider. Change them there.",
    });
    expect(
      (
        await owner.client.call(`/v1/orgs/${org}/groups/${group.id}`, {
          method: "PATCH",
          body: { description: "Pays the bills" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await owner.client.call(`/v1/orgs/${org}/groups/${group.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(409);
    const agentId = newId("agent");
    await withOrg(licensed, orgId(org), (tx) =>
      tx
        .insert(agents)
        .values({ id: agentId, organizationId: org, slug: "ledger" }),
    );
    expect(
      (
        await owner.client.call(
          `/v1/orgs/${org}/agents/${agentId}/grants/${group.id}`,
          {
            method: "PUT",
            body: { access: "viewer" },
          },
        )
      ).status,
    ).toBe(200);

    expect(
      (await scim(licensed, token, "DELETE", `/Groups/${scimGroupId}`)).status,
    ).toBe(204);
    const after = await owner.client.call<{
      synced: boolean;
      syncedRemovedAt: string | null;
      members: unknown[];
      grants: { agentId: string }[];
    }>(`/v1/orgs/${org}/groups/${group.id}`);
    expect(after.body.synced).toBe(true);
    expect(after.body.syncedRemovedAt).not.toBeNull();
    expect(after.body.members).toEqual([]);
    expect(after.body.grants.map((g) => g.agentId)).toEqual([agentId]);
    const status = await owner.client.call<{
      groups: { id: string; removedAt: string | null }[];
      lastSyncAt: string | null;
    }>(`/v1/orgs/${org}/scim`);
    expect(status.body.groups).toEqual([
      expect.objectContaining({
        id: group.id,
        removedAt: after.body.syncedRemovedAt,
      }),
    ]);
    expect(status.body.lastSyncAt).not.toBeNull();

    // A disappeared group is the organization's to edit or delete.
    expect(
      (
        await owner.client.call(
          `/v1/orgs/${org}/groups/${group.id}/members/${annId}`,
          {
            method: "PUT",
          },
        )
      ).status,
    ).toBe(204);

    const actor = `scim:${token.split(".")[0]}`;
    const audited = (await events(org)).filter(
      (e) => e.actorId === actor && e.targetType === "group",
    );
    expect(audited.map((e) => e.action)).toEqual([
      "group.member.added",
      "scim.group.created",
      "group.member.added",
      "scim.group.updated",
      "group.member.removed",
      "scim.group.updated",
      "group.member.removed",
      "scim.group.deleted",
    ]);
    expect(audited.at(-1)).toMatchObject({
      targetId: group.id,
      data: { scimGroup: scimGroupId, group: "finance-team" },
    });
  });

  it("keep a slug of their own when the name is taken", async () => {
    const { owner, org, token } = await directory("Slugco");
    await owner.client.call(`/v1/orgs/${org}/groups`, {
      body: { name: "Ops" },
    });
    const created = await scim(licensed, token, "POST", "/Groups", {
      schemas: [GROUP],
      displayName: "Ops",
    });
    expect(created.status).toBe(201);
    const [synced] = await withOrg(licensed, orgId(org), (tx) =>
      tx.select().from(groups).where(eq(groups.scimGroupId, created.body.id!)),
    );
    expect(synced?.slug).toBe("ops-2");
  });
});

describe("one organization's token", () => {
  it("never reaches another organization's users or groups", async () => {
    const a = await directory("Isolation A");
    const b = await directory("Isolation B");
    const bUser = (
      await scim(licensed, b.token, "POST", "/Users", newUser("Bea"))
    ).body;
    const bGroup = (
      await scim(licensed, b.token, "POST", "/Groups", {
        schemas: [GROUP],
        displayName: "Bravo",
        members: [{ value: bUser.id }],
      })
    ).body;
    const aUser = (
      await scim(licensed, a.token, "POST", "/Users", newUser("Abe"))
    ).body;

    for (const [method, path, body] of [
      ["GET", `/Users/${bUser.id}`],
      ["PUT", `/Users/${bUser.id}`, newUser("Bea")],
      [
        "PATCH",
        `/Users/${bUser.id}`,
        {
          schemas: [PATCH_OP],
          Operations: [{ op: "replace", value: { active: false } }],
        },
      ],
      ["DELETE", `/Users/${bUser.id}`],
      ["GET", `/Groups/${bGroup.id}`],
      [
        "PATCH",
        `/Groups/${bGroup.id}`,
        {
          schemas: [PATCH_OP],
          Operations: [
            { op: "add", path: "members", value: [{ value: aUser.id }] },
          ],
        },
      ],
      ["DELETE", `/Groups/${bGroup.id}`],
    ] as const)
      expect(
        (await scim(licensed, a.token, method, path, body)).status,
        `${method} ${path}`,
      ).toBe(404);
    const addForeign = await scim(licensed, a.token, "POST", "/Groups", {
      schemas: [GROUP],
      displayName: "Alpha",
      members: [{ value: bUser.id }],
    });
    expect(addForeign.status).toBeGreaterThanOrEqual(400);

    const users = await scim(licensed, a.token, "GET", "/Users");
    expect(users.body.Resources?.map((u) => u.id)).toEqual([aUser.id]);
    const groupsOfA = await scim(licensed, a.token, "GET", "/Groups");
    expect(groupsOfA.body.Resources?.map((g) => g.id)).not.toContain(bGroup.id);
    const bea = await linkedUser(bUser.id!);
    expect(await membership(b.org, bea)).toEqual({ role: "member" });
    expect(await membership(a.org, bea)).toBeUndefined();
    expect((await userRow(bea)).deactivatedAt).toBeNull();
    expect(
      (await events(a.org)).some(
        (e) => e.targetId === bea || JSON.stringify(e.data).includes(bUser.id!),
      ),
    ).toBe(false);
  });
});
