// Audit export (doc 02): Owners only, on a plan with audit_export, for a date
// range of at most 90 days, as CSV or NDJSON streamed in seq order with each
// event's hashes. The signing keypair here is made for these tests and
// registered only while they run.

import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Env } from "../src/env.ts";
import worker from "../src/index.ts";
import { licenseKeys } from "../src/license.ts";
import type { Client } from "./helpers.ts";
import { addMember, createOrganization, signUp, testEnv } from "./helpers.ts";

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const day = 86_400_000;
let signing: CryptoKeyPair;
let signingPublic: string;
let licensed: Env;
let org: string;
let owner: Client;
let admin: Client;

const license = async () => {
  const now = Date.now();
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      kid: "test-only",
      customer: "Acme Corp",
      features: ["audit_export"],
      seats: 10,
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

const range = (days: number) => {
  const to = new Date(Date.now() + 60_000);
  return {
    from: new Date(to.getTime() - days * day).toISOString(),
    to: to.toISOString(),
  };
};

// Reads the streamed body before waiting on the request's background work,
// as a browser would; the request's wide log event waits for the stream.
const exportAs = async (client: Client, body: unknown) => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(
      new URL(`/v1/orgs/${org}/audit-events/export`, licensed.APP_URL),
      {
        method: "POST",
        headers: {
          origin: licensed.APP_URL,
          "content-type": "application/json",
          cookie: client.cookie,
        },
        body: JSON.stringify(body),
      },
    ),
    licensed,
    ctx,
  );
  const text = await response.text();
  await waitOnExecutionContext(ctx);
  let parsed: unknown = text;
  if (response.headers.get("content-type")?.startsWith("application/json"))
    parsed = JSON.parse(text);
  return { status: response.status, headers: response.headers, body: parsed };
};

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
    PREPROCESS_LICENSE_KEY: await license(),
  } as unknown as Partial<Env>);
  const signed = await signUp("Exporter");
  owner = signed.client;
  org = await createOrganization(owner, "Exportco");
  admin = (await addMember(owner, org, "Export Admin", "admin")).client;
});

afterAll(() => {
  licenseKeys.splice(licenseKeys.indexOf(signingPublic), 1);
});

describe("audit export", () => {
  it("is for Owners only", async () => {
    const refused = await exportAs(admin, { format: "csv", ...range(1) });
    expect(refused.status).toBe(403);
  });

  it("needs a valid format and a range of at most 90 days", async () => {
    expect((await exportAs(owner, { format: "xml", ...range(1) })).status).toBe(
      400,
    );
    expect((await exportAs(owner, { format: "csv" })).status).toBe(400);
    const tooLong = await exportAs(owner, { format: "csv", ...range(91) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toMatchObject({ error: { code: "range_too_long" } });
    const backwards = range(1);
    const reversed = await exportAs(owner, {
      format: "csv",
      from: backwards.to,
      to: backwards.from,
    });
    expect(reversed.body).toMatchObject({ error: { code: "invalid_range" } });
    expect(
      (await exportAs(owner, { format: "csv", ...range(90) })).status,
    ).toBe(200);
  });

  it("streams CSV with a header row and every event in seq order", async () => {
    const exported = await exportAs(owner, { format: "csv", ...range(1) });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(exported.headers.get("content-disposition")).toMatch(
      /^attachment; filename="audit-events-.*\.csv"$/,
    );
    const lines = (exported.body as string).trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "id,seq,occurredAt,actorType,actorId,onBehalfOf,action,targetType,targetId,caseId,requestId,ip,data,prevHash,hash",
    );
    const actions = lines.slice(1).map((line) => line.split(",")[6]);
    expect(actions.slice(0, 3)).toEqual([
      "organization.created",
      "invitation.created",
      "member.added",
    ]);
    expect(actions).toContain("audit.exported");
    const seqs = lines.slice(1).map((line) => Number(line.split(",")[1]));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it("streams NDJSON with each event's hashes, filtered like the list", async () => {
    const exported = await exportAs(owner, {
      format: "ndjson",
      action: "member.added",
      ...range(1),
    });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("application/x-ndjson");
    const events = (exported.body as string)
      .trimEnd()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as { action: string; hash: string; seq: number },
      );
    expect(events.map((e) => e.action)).toEqual(["member.added"]);
    expect(events[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("leaves out events outside the range", async () => {
    const past = new Date(Date.now() - 30 * day);
    const exported = await exportAs(owner, {
      format: "ndjson",
      from: new Date(past.getTime() - day).toISOString(),
      to: past.toISOString(),
    });
    expect(exported.status).toBe(200);
    expect(exported.body).toBe("");
  });
});
