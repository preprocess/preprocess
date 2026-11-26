// The offline license key and the seat limit (spec 16 License key, Expiry,
// Limits, Entitlements; 16a Self-hosted). The signing keypair here is made
// for these tests and registered only while they run; no private key is kept.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
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
  const raw = await crypto.subtle.exportKey("raw", signing.publicKey);
  licenseKeys[TEST_KID] = base64url(new Uint8Array(raw as ArrayBuffer));
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

  it("an unknown kid is invalid", async () => {
    const key = await sign({ kid: "nobody-2026" });
    expect((await readLicense(key)).status).toBe("invalid");
    expect((await getPlan(selfHosted(key), anyOrg)).name).toBe("free");
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
