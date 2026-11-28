// The request sequences Okta's SCIM 2.0 test suite and Microsoft Entra's
// SCIM validator send, scripted against our endpoint (Entra's validator runs
// only on the web, so this is its sequence, not the tool). Each step checks
// the status and the shape a provisioning client relies on.

import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import type { Env } from "../src/env.ts";
import worker from "../src/index.ts";
import { licenseKeys } from "../src/license.ts";
import {
  Client,
  createOrganization,
  signUp,
  testEnv,
  unique,
} from "./helpers.ts";

const PATCH_OP = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const ENTERPRISE = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
const LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";

type Body = Record<string, unknown> & {
  id?: string;
  Resources?: (Record<string, unknown> & { id?: string })[];
  members?: { value: string }[];
};

let environment: Env;
let token: string;

const call = async (method: string, path: string, body?: unknown) => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(new URL(`/api/auth/scim/v2${path}`, environment.APP_URL), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
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
    type: response.headers.get("content-type"),
    body: (text ? JSON.parse(text) : {}) as Body,
  };
};

const filter = (expression: string) =>
  `filter=${encodeURIComponent(expression)}`;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

beforeAll(async () => {
  const signing = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  licenseKeys.push(
    base64url(
      new Uint8Array(
        (await crypto.subtle.exportKey(
          "raw",
          signing.publicKey,
        )) as ArrayBuffer,
      ),
    ),
  );
  const now = Date.now();
  const payload = new TextEncoder().encode(
    JSON.stringify({
      kid: "test-only",
      customer: "Conformance Corp",
      features: ["scim", "synced_groups"],
      seats: 100,
      issuedAt: new Date(now - 86_400_000).toISOString(),
      expiresAt: new Date(now + 86_400_000).toISOString(),
    }),
  );
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    signing.privateKey,
    payload,
  );
  environment = testEnv({
    PREPROCESS_REGION: undefined,
    PREPROCESS_LICENSE_KEY: `${base64url(payload)}.${base64url(new Uint8Array(signature))}`,
  } as unknown as Partial<Env>);
  const owner = await signUp("Conformance Owner");
  const org = await createOrganization(owner.client, "Conformance");
  const client = new Client(environment);
  client.cookie = owner.client.cookie;
  const issued = await client.call<{ token: string }>(
    `/v1/orgs/${org}/scim/tokens`,
    { body: {} },
  );
  token = issued.body.token;
});

describe("discovery", () => {
  it("describes the service, its resource types and schemas", async () => {
    const config = await call("GET", "/ServiceProviderConfig");
    expect(config.status).toBe(200);
    expect(config.type).toBe("application/scim+json");
    expect(config.body).toMatchObject({
      patch: { supported: true },
      filter: { supported: true },
    });
    const types = await call("GET", "/ResourceTypes");
    expect(types.status).toBe(200);
    expect(JSON.stringify(types.body)).toContain('"/Users"');
    expect(JSON.stringify(types.body)).toContain('"/Groups"');
    const schemas = await call("GET", "/Schemas");
    expect(schemas.status).toBe(200);
    expect(JSON.stringify(schemas.body)).toContain(USER);
    expect(JSON.stringify(schemas.body)).toContain(GROUP);
    expect((await call("GET", `/Schemas/${USER}`)).status).toBe(200);
  });

  it("refuses a missing or wrong token with a SCIM error", async () => {
    const saved = token;
    token = "ba_scim_credential_wrong.secret";
    const refused = await call("GET", "/Users");
    token = saved;
    expect(refused.status).toBe(401);
    expect(refused.body.schemas).toEqual([ERROR]);
  });
});

describe("Okta's SCIM 2.0 test sequence", () => {
  it("provisions, finds, updates, deactivates and pushes groups", async () => {
    const userName = `${unique("okta")}@okta.test`;
    const probe = await call(
      "GET",
      `/Users?${filter(`userName eq "${userName}"`)}&startIndex=1&count=100`,
    );
    expect(probe.status).toBe(200);
    expect(probe.body).toMatchObject({ schemas: [LIST], totalResults: 0 });

    const user = {
      schemas: [USER],
      userName,
      name: { givenName: "Okta", familyName: "Person" },
      emails: [{ primary: true, value: userName, type: "work" }],
      displayName: "Okta Person",
      locale: "en-US",
      externalId: unique("00u"),
      groups: [],
      password: "never-stored-1!",
      active: true,
    };
    const created = await call("POST", "/Users", user);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ userName, active: true });
    expect(JSON.stringify(created.body)).not.toContain("never-stored");
    const id = created.body.id!;

    const found = await call(
      "GET",
      `/Users?${filter(`userName eq "${userName}"`)}&startIndex=1&count=100`,
    );
    expect(found.body.totalResults).toBe(1);
    expect(found.body.Resources?.[0]?.id).toBe(id);
    expect((await call("GET", `/Users/${id}`)).body.id).toBe(id);

    const duplicate = await call("POST", "/Users", user);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({
      schemas: [ERROR],
      scimType: "uniqueness",
    });

    const updated = await call("PUT", `/Users/${id}`, {
      ...user,
      id,
      name: { givenName: "Okta", familyName: "Renamed" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: { familyName: "Renamed" } });

    const deactivated = await call("PATCH", `/Users/${id}`, {
      schemas: [PATCH_OP],
      Operations: [{ op: "replace", value: { active: false } }],
    });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.active).toBe(false);

    const missing = await call("GET", "/Users/010101010101");
    expect(missing.status).toBe(404);
    expect(missing.body.schemas).toEqual([ERROR]);

    const reactivated = await call("PATCH", `/Users/${id}`, {
      schemas: [PATCH_OP],
      Operations: [{ op: "replace", value: { active: true } }],
    });
    expect(reactivated.body.active).toBe(true);

    const displayName = unique("Okta Group");
    const group = await call("POST", "/Groups", {
      schemas: [GROUP],
      displayName,
      members: [],
    });
    expect(group.status).toBe(201);
    const groupId = group.body.id!;
    const byName = await call(
      "GET",
      `/Groups?${filter(`displayName eq "${displayName}"`)}&startIndex=1&count=100`,
    );
    expect(byName.body.Resources?.[0]?.id).toBe(groupId);

    const pushed = await call("PATCH", `/Groups/${groupId}`, {
      schemas: [PATCH_OP],
      Operations: [
        {
          op: "replace",
          path: "members",
          value: [{ value: id, display: userName }],
        },
      ],
    });
    expect(pushed.status).toBeLessThan(300);
    const renamed = await call("PATCH", `/Groups/${groupId}`, {
      schemas: [PATCH_OP],
      Operations: [
        {
          op: "replace",
          value: { id: groupId, displayName: `${displayName} 2` },
        },
      ],
    });
    expect(renamed.status).toBeLessThan(300);
    const read = await call("GET", `/Groups/${groupId}`);
    expect(read.body).toMatchObject({ displayName: `${displayName} 2` });
    expect(read.body.members?.map((m) => m.value)).toEqual([id]);
    const emptied = await call("PATCH", `/Groups/${groupId}`, {
      schemas: [PATCH_OP],
      Operations: [{ op: "remove", path: `members[value eq "${id}"]` }],
    });
    expect(emptied.status).toBeLessThan(300);
    expect((await call("DELETE", `/Groups/${groupId}`)).status).toBe(204);
    expect((await call("GET", `/Groups/${groupId}`)).status).toBe(404);
  });
});

describe("Microsoft Entra's SCIM validator sequence", () => {
  it("creates with the enterprise extension, patches Entra's shapes, and deletes", async () => {
    const userName = `${unique("entra")}@entra.test`;
    const externalId = crypto.randomUUID();
    const probe = await call(
      "GET",
      `/Users?${filter(`userName eq "${userName}"`)}`,
    );
    expect(probe.body.totalResults).toBe(0);

    const created = await call("POST", "/Users", {
      schemas: [USER, ENTERPRISE],
      externalId,
      userName,
      active: true,
      displayName: "Entra Person",
      emails: [{ primary: true, type: "work", value: userName }],
      name: {
        formatted: "Entra Person",
        familyName: "Person",
        givenName: "Entra",
      },
      title: "Engineer",
      [ENTERPRISE]: { department: "Platform", employeeNumber: "42" },
      roles: [],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      [ENTERPRISE]: { department: "Platform" },
    });
    const id = created.body.id!;

    const byExternal = await call(
      "GET",
      `/Users?${filter(`externalId eq "${externalId}"`)}`,
    );
    expect(byExternal.body.Resources?.[0]?.id).toBe(id);

    const patched = await call("PATCH", `/Users/${id}`, {
      schemas: [PATCH_OP],
      Operations: [
        { op: "Replace", path: "displayName", value: "Entra Renamed" },
        { op: "Replace", path: "name.givenName", value: "Entra2" },
        { op: "Add", path: 'emails[type eq "work"].value', value: userName },
        { op: "Replace", path: `${ENTERPRISE}:department`, value: "Security" },
        { op: "Replace", path: "title", value: "Lead" },
      ],
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({
      displayName: "Entra Renamed",
      name: { givenName: "Entra2" },
      title: "Lead",
      [ENTERPRISE]: { department: "Security" },
    });

    const disabled = await call("PATCH", `/Users/${id}`, {
      schemas: [PATCH_OP],
      Operations: [{ op: "Replace", path: "active", value: "False" }],
    });
    expect(disabled.body.active).toBe(false);

    const displayName = unique("Entra Group");
    const group = await call("POST", "/Groups", {
      schemas: [
        GROUP,
        "http://schemas.microsoft.com/2006/11/ResourceManagement/ADSCIM/2.0/Group",
      ],
      externalId: crypto.randomUUID(),
      displayName,
    });
    expect(group.status).toBe(201);
    const groupId = group.body.id!;
    const lean = await call(
      "GET",
      `/Groups?excludedAttributes=members&${filter(`displayName eq "${displayName}"`)}`,
    );
    expect(lean.body.Resources?.[0]).toMatchObject({
      id: groupId,
      displayName,
    });
    expect(lean.body.Resources?.[0]).not.toHaveProperty("members");

    const added = await call("PATCH", `/Groups/${groupId}`, {
      schemas: [PATCH_OP],
      Operations: [{ op: "Add", path: "members", value: [{ value: id }] }],
    });
    expect(added.status).toBeLessThan(300);
    expect((await call("GET", `/Groups/${groupId}`)).body.members).toHaveLength(
      1,
    );
    const removed = await call("PATCH", `/Groups/${groupId}`, {
      schemas: [PATCH_OP],
      Operations: [{ op: "Remove", path: "members", value: [{ value: id }] }],
    });
    expect(removed.status).toBeLessThan(300);
    expect(
      (await call("GET", `/Groups/${groupId}`)).body.members ?? [],
    ).toHaveLength(0);

    expect((await call("DELETE", `/Users/${id}`)).status).toBe(204);
    expect((await call("GET", `/Users/${id}`)).status).toBe(404);
    expect((await call("DELETE", `/Groups/${groupId}`)).status).toBe(204);
  });
});
