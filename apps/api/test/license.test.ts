// The offline license key and the seat limit (spec 16 License key, Expiry,
// Limits, Entitlements; 16a Self-hosted). The signing keypair here is made
// for these tests and registered only while they run; no private key is kept.

import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { installLicense } from "@preprocess/db/schema/license";
import { env as bindings } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Env } from "../src/env.ts";
import { licenseKeys, readLicense } from "../src/license.ts";
import { getPlan } from "../src/plan.ts";
import { countSeats } from "../src/seats.ts";
import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";

const TEST_KID = "test-only";
const day = 24 * 60 * 60 * 1000;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const generate = () =>
  crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]) as Promise<CryptoKeyPair>;

let signing: CryptoKeyPair;
let other: CryptoKeyPair;
let signingPublic: string;

const publicOf = async (pair: CryptoKeyPair) =>
  base64url(
    new Uint8Array(
      (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
    ),
  );

type Payload = {
  kid?: string;
  customer?: string;
  features?: string[];
  seats?: number;
  issuedAt?: Date;
  expiresAt?: Date;
};

const sign = async (payload: Payload = {}, key = signing.privateKey) => {
  const now = Date.now();
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      kid: payload.kid ?? TEST_KID,
      customer: payload.customer ?? "Acme Corp",
      features: payload.features ?? ["sso", "audit_export"],
      seats: payload.seats ?? 10,
      issuedAt: (payload.issuedAt ?? new Date(now - day)).toISOString(),
      expiresAt: (payload.expiresAt ?? new Date(now + 364 * day)).toISOString(),
    }),
  );
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, key, bytes);
  return `${base64url(bytes)}.${base64url(new Uint8Array(signature))}`;
};

const selfHosted = (key?: string): Env =>
  testEnv({
    PREPROCESS_REGION: undefined,
    PREPROCESS_LICENSE_KEY: key,
  } as unknown as Partial<Env>);

const anyOrg = orgId("org_license_unit");

beforeAll(async () => {
  signing = await generate();
  other = await generate();
  signingPublic = await publicOf(signing);
  licenseKeys[TEST_KID] = signingPublic;
});

afterAll(() => {
  delete licenseKeys[TEST_KID];
});

describe("license key", () => {
  it("a valid key gives the licensed plan with the key's features and seats", async () => {
    const key = await sign({
      features: ["sso", "audit_export", "future_thing"],
    });
    const state = await readLicense(key);
    expect(state.status).toBe("active");
    const plan = await getPlan(selfHosted(key), anyOrg);
    expect(plan.name).toBe("licensed");
    expect(plan.features).toEqual(["audit_export", "sso"]);
    expect(plan.has("sso")).toBe(true);
    expect(plan.has("scim")).toBe(false);
    expect(() => plan.assert("audit_export")).not.toThrow();
    expect(() => plan.assert("scim")).toThrow();
    expect(plan.limits.seats).toBe(10);
    expect(plan.exceeds("seats", 10)).toBe(false);
    expect(plan.exceeds("seats", 11)).toBe(true);
  });

  it("a wrong signature is invalid and gives the free plan", async () => {
    const forged = await sign({}, other.privateKey);
    expect((await readLicense(forged)).status).toBe("invalid");
    const plan = await getPlan(selfHosted(forged), anyOrg);
    expect(plan.name).toBe("free");
    expect(plan.has("sso")).toBe(false);
    expect(plan.limits.seats).toBeNull();
  });

  it("an edited payload no longer verifies", async () => {
    const [payload, signature] = (await sign({ seats: 10 })).split(".");
    const edited = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(
          atob(payload!.replaceAll("-", "+").replaceAll("_", "/")),
          (c) => c.charCodeAt(0),
        ),
      ),
    ) as Record<string, unknown>;
    edited.seats = 1000;
    const tampered = `${base64url(new TextEncoder().encode(JSON.stringify(edited)))}.${signature}`;
    expect((await readLicense(tampered)).status).toBe("invalid");
  });

  it("rejects a kid the build doesn't know, even when its key signed it", async () => {
    expect((await readLicense(await sign({ kid: "unknown" }))).status).toBe(
      "invalid",
    );
    for (const kid of ["__proto__", "constructor", "toString"])
      expect((await readLicense(await sign({ kid }))).status).toBe("invalid");
  });

  it("verifies only against the key its kid names", async () => {
    const otherPublic = await publicOf(other);
    const keys = { ...licenseKeys, "other-kid": otherPublic };
    // Signed by the other key but claiming the test kid.
    const misnamed = await sign({}, other.privateKey);
    expect((await readLicense(misnamed, new Date(), keys)).status).toBe(
      "invalid",
    );
    // Signed by the test key but claiming the other kid.
    const claimed = await sign({ kid: "other-kid" });
    expect((await readLicense(claimed, new Date(), keys)).status).toBe(
      "invalid",
    );
  });

  it("a rotation adds the new kid beside the current one", async () => {
    const next = await generate();
    const byNext = await sign({ kid: "next-2027" }, next.privateKey);
    const byCurrent = await sign();
    expect((await readLicense(byNext)).status).toBe("invalid");
    const keys = { ...licenseKeys, "next-2027": await publicOf(next) };
    expect((await readLicense(byCurrent, new Date(), keys)).status).toBe(
      "active",
    );
    const state = await readLicense(byNext, new Date(), keys);
    expect(state.status).toBe("active");
    expect(state.status === "active" && state.license.kid).toBe("next-2027");
    // Retiring the old kid leaves its licenses invalid.
    expect(
      (
        await readLicense(byCurrent, new Date(), {
          "next-2027": await publicOf(next),
        })
      ).status,
    ).toBe("invalid");
  });

  it("ships no signing key yet, so nothing verifies", async () => {
    expect(Object.keys(licenseKeys).filter((k) => k !== TEST_KID)).toEqual([]);
    expect((await readLicense(await sign(), new Date(), {})).status).toBe(
      "invalid",
    );
  });

  it("garbage and no key give the free plan", async () => {
    expect((await readLicense("not-a-key")).status).toBe("invalid");
    expect((await readLicense("a.b.c")).status).toBe("invalid");
    expect((await readLicense(undefined)).status).toBe("none");
    const plan = await getPlan(selfHosted(), anyOrg);
    expect(plan.name).toBe("free");
    expect(plan.license).toEqual({ status: "none" });
  });

  it("an expired key keeps its features for 30 days of grace", async () => {
    const key = await sign({ expiresAt: new Date(Date.now() - 5 * day) });
    const plan = await getPlan(selfHosted(key), anyOrg);
    expect(plan.name).toBe("licensed");
    expect(plan.license?.status).toBe("grace");
    expect(plan.has("sso")).toBe(true);
    expect(plan.limits.seats).toBe(10);
  });

  it("past grace, paid features turn off", async () => {
    const key = await sign({ expiresAt: new Date(Date.now() - 31 * day) });
    const plan = await getPlan(selfHosted(key), anyOrg);
    expect(plan.name).toBe("free");
    expect(plan.license?.status).toBe("expired");
    expect(plan.has("sso")).toBe(false);
    expect(() => plan.assert("audit_export")).toThrow();
  });

  it("our cloud ignores the key", async () => {
    const key = await sign();
    const plan = await getPlan(
      testEnv({ PREPROCESS_REGION: "us", PREPROCESS_LICENSE_KEY: key }),
      anyOrg,
    );
    expect(plan.name).toBe("free");
    expect(plan.has("sso")).toBe(false);
    expect(plan.limits.seats).toBeNull();
    expect(plan.license).toBeNull();
  });
});

type PlanBody = {
  name: string;
  limits: { seats: number | null };
  seats?: {
    used: number;
    limit: number | null;
    ceiling: number | null;
    warning: boolean;
  };
  license?: { status: string; customer: string | null } | null;
};

describe("seat limit", () => {
  // A 10-seat key: Admins are warned at 10 seats, and 11 (about 10% over) is
  // the most changes may reach.
  let env: Env;
  let owner: Client;
  let ownerId: string;
  let admin: Client;
  let adminId: string;
  let viewerClient: Client;
  let org: string;
  let developers: string;
  let ops: string;
  let viewers: string;
  const people: string[] = [];
  const agentId = newId("agent");

  const as = (client: Client) => {
    const switched = new Client(env);
    switched.cookie = client.cookie;
    return switched;
  };
  const join = (group: string, user: string) =>
    as(owner).call<{ error?: { code: string; message: string } }>(
      `/v1/orgs/${org}/groups/${group}/members/${user}`,
      { method: "PUT" },
    );
  const grant = (group: string, access: "operator" | "viewer") =>
    as(owner).call<{ error?: { code: string; message: string } }>(
      `/v1/orgs/${org}/agents/${agentId}/grants/${group}`,
      { method: "PUT", body: { access } },
    );
  const plan = (client: Client) =>
    as(client).call<PlanBody>(`/v1/orgs/${org}/plan`);
  const seats = () => withOrg(env, orgId(org), countSeats);
  const newGroup = async (name: string) =>
    (
      await as(owner).call<{ id: string }>(`/v1/orgs/${org}/groups`, {
        body: { name },
      })
    ).body.id;

  beforeAll(async () => {
    env = selfHosted(await sign({ seats: 10 }));
    const signedUp = await signUp("Seat Owner");
    owner = signedUp.client;
    ownerId = signedUp.userId;
    org = await createOrganization(owner, "Seatco");
    const a = await addMember(owner, org, "Seat Admin", "admin");
    admin = a.client;
    adminId = a.userId;
    for (let i = 1; i <= 12; i++) {
      const m = await addMember(owner, org, `Seat Person${i}`);
      people.push(m.userId);
      if (i === 3) viewerClient = m.client;
    }
    await withOrg(env, orgId(org), (tx) =>
      tx
        .insert(agents)
        .values({ id: agentId, organizationId: org, slug: "seats" }),
    );
    const listed = await as(owner).call<
      { id: string; isDevelopers: boolean }[]
    >(`/v1/orgs/${org}/groups`);
    developers = listed.body.find((g) => g.isDevelopers)!.id;
    ops = await newGroup("Ops");
    viewers = await newGroup("Watchers");
    expect((await grant(ops, "operator")).status).toBe(200);
    expect((await grant(viewers, "viewer")).status).toBe(200);
  });

  it("counts developers and operators once, and owners, admins and viewers as free", async () => {
    expect(await seats()).toBe(0);
    expect((await join(developers, people[0]!)).status).toBe(204);
    expect((await join(developers, people[1]!)).status).toBe(204);
    // In Developers and an operator group: still one seat.
    expect((await join(ops, people[1]!)).status).toBe(204);
    // Viewers are free.
    expect((await join(viewers, people[2]!)).status).toBe(204);
    expect((await join(viewers, adminId)).status).toBe(204);
    expect(await seats()).toBe(2);

    const shown = await plan(owner);
    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({
      name: "licensed",
      limits: { seats: 10 },
      seats: { used: 2, limit: 10, ceiling: 11, warning: false },
      license: { status: "active", customer: "Acme Corp" },
    });
    // Members see the plan but not the admin warnings.
    const asMember = await plan(viewerClient);
    expect(asMember.body.seats).toBeUndefined();
    expect(asMember.body.license).toBeUndefined();
  });

  it("warns Admins at the limit and blocks past about 10% over", async () => {
    // people[3..10] are 8 more operators: 10 seats, the limit.
    for (const person of people.slice(3, 11))
      expect((await join(ops, person)).status).toBe(204);
    expect(await seats()).toBe(10);
    const atLimit = await plan(admin);
    expect(atLimit.body.seats).toMatchObject({ used: 10, warning: true });

    // 11 is within 10% over.
    expect((await join(developers, people[11]!)).status).toBe(204);
    expect(await seats()).toBe(11);

    // The 12th seat is refused, as a developer or as an operator.
    const refused = await join(developers, ownerId);
    expect(refused.status).toBe(402);
    expect(refused.body.error?.code).toBe("seat_limit_reached");
    expect((await join(ops, ownerId)).status).toBe(402);
    expect(await seats()).toBe(11);

    // Changes that add no seat still go through.
    expect((await join(ops, people[0]!)).status).toBe(204);
    expect((await join(viewers, ownerId)).status).toBe(204);

    // Operator access for Watchers would make its two free members seats.
    const granted = await grant(viewers, "operator");
    expect(granted.status).toBe(402);
    expect(granted.body.error?.code).toBe("seat_limit_reached");
    expect((await grant(viewers, "viewer")).status).toBe(200);
    expect(await seats()).toBe(11);
  });

  it("has no seat limit on our cloud, key or not", async () => {
    const cloud = testEnv({
      PREPROCESS_REGION: "us",
      PREPROCESS_LICENSE_KEY: env.PREPROCESS_LICENSE_KEY!,
    });
    const client = new Client(cloud);
    client.cookie = owner.cookie;
    const shown = await client.call<PlanBody>(`/v1/orgs/${org}/plan`);
    expect(shown.body).toMatchObject({
      name: "free",
      limits: { seats: null },
      seats: { used: 11, limit: null, warning: false },
      license: null,
    });
    const added = await client.call(
      `/v1/orgs/${org}/groups/${developers}/members/${ownerId}`,
      { method: "PUT" },
    );
    expect(added.status).toBe(204);
  });

  it("shows Admins a key in its grace period", async () => {
    env = selfHosted(
      await sign({ seats: 10, expiresAt: new Date(Date.now() - 2 * day) }),
    );
    const shown = await plan(admin);
    expect(shown.body.name).toBe("licensed");
    expect(shown.body.license?.status).toBe("grace");
  });
});

type LicenseBody = {
  status: string;
  source: string | null;
  uploadedAt: string | null;
  customer: string | null;
  seats: { used: number; limit: number | null };
  expiresAt: string | null;
  graceEndsAt: string | null;
  error?: { code: string; message: string };
};

describe("uploaded license key", () => {
  // The install-wide row lives in its own database, so test files running at
  // the same time never see this file's key.
  const install = (key?: string) =>
    testEnv({
      PREPROCESS_REGION: undefined,
      PREPROCESS_LICENSE_KEY: key,
      DB: bindings.INSTALL_DB,
      DB_SYSTEM: bindings.INSTALL_DB_SYSTEM,
    } as unknown as Partial<Env>);
  let env: Env;
  let owner: Client;
  let ownerId: string;
  let admin: Client;
  let member: Client;
  let org: string;

  const on = (client: Client, environment = env) => {
    const moved = new Client(environment);
    moved.cookie = client.cookie;
    return moved;
  };
  const status = (client: Client, environment = env) =>
    on(client, environment).call<LicenseBody>(`/v1/orgs/${org}/license`);
  const upload = (client: Client, key: string, environment = env) =>
    on(client, environment).call<LicenseBody>(`/v1/orgs/${org}/license`, {
      method: "PUT",
      body: { key },
    });
  const stored = () =>
    withoutOrg(env, "test: stored license", (tx) =>
      tx.select().from(installLicense),
    );

  beforeAll(async () => {
    env = install();
    const signedUp = await signUp("License Owner", env);
    owner = signedUp.client;
    ownerId = signedUp.userId;
    org = await createOrganization(owner, "Licenseco");
    admin = (await addMember(owner, org, "License Admin", "admin")).client;
    member = (await addMember(owner, org, "License Member")).client;
  });

  it("starts with no license", async () => {
    const shown = await status(owner);
    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({
      status: "none",
      source: null,
      customer: null,
      seats: { limit: null },
    });
    expect((await getPlan(env, orgId(org))).name).toBe("free");
  });

  it("refuses a key that doesn't verify and stores nothing", async () => {
    for (const key of ["not-a-key", await sign({}, other.privateKey)]) {
      const refused = await upload(owner, key);
      expect(refused.status).toBe(400);
      expect(refused.body.error).toEqual({
        code: "invalid_license",
        message:
          "This license key isn't valid. Check that you pasted the whole key.",
      });
    }
    const past = await upload(
      owner,
      await sign({ expiresAt: new Date(Date.now() - 31 * day) }),
    );
    expect(past.status).toBe(400);
    expect(past.body.error?.code).toBe("license_expired");
    expect(await stored()).toEqual([]);
    expect((await status(owner)).body.status).toBe("none");
  });

  it("lets only Owners upload, and Owners and Admins read", async () => {
    const key = await sign();
    for (const client of [admin, member]) {
      const refused = await upload(client, key);
      expect(refused.status).toBe(403);
    }
    expect(await stored()).toEqual([]);
    expect((await status(admin)).status).toBe(200);
    expect((await status(member)).status).toBe(403);
  });

  it("an uploaded valid key licenses the install, audited without the key", async () => {
    const key = await sign({ customer: "Upload Corp", seats: 25 });
    const uploaded = await upload(owner, key);
    expect(uploaded.status).toBe(204);

    const shown = await status(admin);
    expect(shown.body).toMatchObject({
      status: "active",
      source: "upload",
      customer: "Upload Corp",
      seats: { used: 0, limit: 25 },
    });
    expect(shown.body.uploadedAt).not.toBeNull();
    const plan = await getPlan(env, orgId(org));
    expect(plan.name).toBe("licensed");
    expect(plan.has("sso")).toBe(true);
    expect(plan.limits.seats).toBe(25);

    const [row] = await stored();
    expect(row).toMatchObject({ key, uploadedBy: ownerId });

    const events = await on(owner).call<{
      events: {
        action: string;
        actorId: string;
        data: Record<string, unknown>;
      }[];
    }>(`/v1/orgs/${org}/audit-events?action=license.uploaded`);
    expect(events.body.events).toHaveLength(1);
    const [event] = events.body.events;
    expect(event).toMatchObject({
      actorId: ownerId,
      data: {
        customer: "Upload Corp",
        seats: 25,
        expiresAt: shown.body.expiresAt,
      },
    });
    expect(JSON.stringify(event)).not.toContain(key.split(".")[1]!);
  });

  it("the uploaded key wins over PREPROCESS_LICENSE_KEY", async () => {
    const configured = install(await sign({ customer: "Env Corp", seats: 3 }));
    const plan = await getPlan(configured, orgId(org));
    expect(
      plan.license?.status === "active" && plan.license.license.customer,
    ).toBe("Upload Corp");
    expect(plan.limits.seats).toBe(25);
    expect((await status(owner, configured)).body).toMatchObject({
      source: "upload",
      customer: "Upload Corp",
    });
  });

  it("a key in its grace period keeps paid features", async () => {
    const graceKey = await sign({
      customer: "Grace Corp",
      expiresAt: new Date(Date.now() - 3 * day),
    });
    expect((await upload(owner, graceKey)).status).toBe(204);
    const shown = await status(owner);
    expect(shown.body).toMatchObject({
      status: "grace",
      customer: "Grace Corp",
    });
    expect(new Date(shown.body.graceEndsAt!).getTime()).toBeGreaterThan(
      Date.now(),
    );
    const plan = await getPlan(env, orgId(org));
    expect(plan.name).toBe("licensed");
    expect(plan.has("sso")).toBe(true);
  });

  it("past grace, the uploaded key gives the free plan", async () => {
    // The stored key's grace ran out since it was uploaded.
    const lapsed = await sign({ expiresAt: new Date(Date.now() - 40 * day) });
    await withoutOrg(env, "test: lapse license", (tx) =>
      tx.update(installLicense).set({ key: lapsed }),
    );
    const plan = await getPlan(env, orgId(org));
    expect(plan.name).toBe("free");
    expect(plan.has("sso")).toBe(false);
    expect(plan.license?.status).toBe("expired");
    expect((await status(admin)).body.status).toBe("expired");
  });

  it("answers 404 on our cloud", async () => {
    const cloud = testEnv({
      PREPROCESS_REGION: "us",
      DB: bindings.INSTALL_DB,
      DB_SYSTEM: bindings.INSTALL_DB_SYSTEM,
    });
    expect((await status(owner, cloud)).status).toBe(404);
    expect((await upload(owner, await sign(), cloud)).status).toBe(404);
    expect((await getPlan(cloud, orgId(org))).license).toBeNull();
  });
});
