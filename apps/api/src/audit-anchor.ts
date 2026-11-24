// The daily signed copy of each organization's audit chain (doc 02). For
// organization o and UTC day d it writes, to the AUDIT bucket:
//
//   audit/{o}/{yyyy}/{mm}/{dd}/events.ndjson  canonical events of d, by seq
//   audit/{o}/{yyyy}/{mm}/{dd}/manifest.json  head of the chain at the end of d, signed
//
// A day with no events still gets a manifest, so a truncated tail shows.
// Writing is idempotent per (o, d): an existing manifest is verified, not
// rewritten. A cron trigger anchors every organization through yesterday,
// catching up any days a missed run left.

import {
  canonical,
  readAuditEvents,
  toHex,
  ZERO_HASH,
} from "@preprocess/db/audit";
import type { AuditRow } from "@preprocess/db/audit";
import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { auditEvents, auditHeads } from "@preprocess/db/schema/audit";
import { and, desc, eq, lt, sql } from "drizzle-orm";

import type { Env } from "./env.ts";

export type AuditManifest = {
  v: 1;
  organizationId: string;
  day: string;
  firstSeq: number | null;
  lastSeq: number;
  count: number;
  prevHash: string;
  headHash: string;
  eventsSha256: string | null;
  signedAt: string;
  keyId: string;
  signature: string;
};

const DAY = 86_400_000;
export const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const startOf = (day: string) => new Date(`${day}T00:00:00.000Z`);
const nextDay = (day: string) => dayOf(new Date(startOf(day).getTime() + DAY));
export const manifestKey = (org: string, day: string) =>
  `audit/${org}/${day.replaceAll("-", "/")}/manifest.json`;
const eventsKey = (org: string, day: string) =>
  `audit/${org}/${day.replaceAll("-", "/")}/events.ndjson`;

const base64 = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text: string) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const sha256Hex = async (text: string) =>
  toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  );

const signingKey = (env: Env) =>
  crypto.subtle.importKey(
    "pkcs8",
    fromBase64(env.AUDIT_SIGNING_KEY),
    { name: "Ed25519" },
    true,
    ["sign"],
  );

// The public half, served at GET /v1/audit/keys so anyone can check a
// manifest without trusting us.
export const publicKeys = async (env: Env) => {
  const jwk = (await crypto.subtle.exportKey(
    "jwk",
    await signingKey(env),
  )) as JsonWebKey;
  return [{ keyId: env.AUDIT_SIGNING_KEY_ID, alg: "Ed25519", x: jwk.x! }];
};

const verifyKey = async (env: Env) => {
  const [key] = await publicKeys(env);
  return crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", x: key!.x },
    { name: "Ed25519" },
    false,
    ["verify"],
  );
};

const unsigned = ({ signature: _s, ...rest }: AuditManifest) => rest;

export const checkSignature = async (env: Env, manifest: AuditManifest) =>
  manifest.keyId === env.AUDIT_SIGNING_KEY_ID &&
  crypto.subtle.verify(
    "Ed25519",
    await verifyKey(env),
    fromBase64(manifest.signature),
    new TextEncoder().encode(canonical(unsigned(manifest))),
  );

const line = (row: AuditRow) =>
  canonical({
    ...row,
    prevHash: toHex(row.prevHash),
    hash: toHex(row.hash),
  });

// The last event before `before`, which is the chain's head at that moment.
const headBefore = async (tx: Tx, org: string, before: Date) => {
  const [last] = await tx
    .select({ seq: auditEvents.seq, hash: auditEvents.hash })
    .from(auditEvents)
    .where(
      and(eq(auditEvents.organizationId, org), lt(auditEvents.occurredAt, before)),
    )
    .orderBy(desc(auditEvents.seq))
    .limit(1);
  return last ?? { seq: 0, hash: ZERO_HASH };
};

export const anchorDay = async (env: Env, org: string, day: string) => {
  const existing = await env.AUDIT.get(manifestKey(org, day));
  if (existing) {
    const manifest = await existing.json<AuditManifest>();
    if (!(await checkSignature(env, manifest)))
      throw new Error(`audit manifest ${org}/${day} has a bad signature`);
    return manifest;
  }

  const { events, start } = await withOrg(env, orgId(org), async (tx) => {
    const rows: AuditRow[] = [];
    let afterSeq = (await headBefore(tx, org, startOf(day))).seq;
    for (;;) {
      const page = await readAuditEvents(tx, org, {
        afterSeq,
        from: startOf(day),
        to: startOf(nextDay(day)),
      });
      rows.push(...page);
      if (page.length < 1000) break;
      afterSeq = page.at(-1)!.seq;
    }
    return { events: rows, start: await headBefore(tx, org, startOf(day)) };
  });

  const ndjson = events.map((e) => `${line(e)}\n`).join("");
  const last = events.at(-1);
  const body: Omit<AuditManifest, "signature"> = {
    v: 1,
    organizationId: org,
    day,
    firstSeq: events[0]?.seq ?? null,
    lastSeq: last?.seq ?? start.seq,
    count: events.length,
    prevHash: toHex(events[0]?.prevHash ?? start.hash),
    headHash: toHex(last?.hash ?? start.hash),
    eventsSha256: events.length ? await sha256Hex(ndjson) : null,
    signedAt: new Date().toISOString(),
    keyId: env.AUDIT_SIGNING_KEY_ID,
  };
  const signature = base64(
    await crypto.subtle.sign(
      "Ed25519",
      await signingKey(env),
      new TextEncoder().encode(canonical(body)),
    ),
  );
  const manifest: AuditManifest = { ...body, signature };
  if (events.length)
    await env.AUDIT.put(eventsKey(org, day), ndjson, {
      httpMetadata: { contentType: "application/x-ndjson" },
    });
  await env.AUDIT.put(manifestKey(org, day), JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" },
  });
  return manifest;
};

// Anchors one organization from the day after its last anchor (or its first
// event) through `through`, recording progress on its head row.
export const anchorOrganization = async (
  env: Env,
  org: string,
  through: string,
) => {
  const { anchoredThrough, firstDay } = await withOrg(
    env,
    orgId(org),
    async (tx) => {
      const [head] = await tx
        .select({ anchoredThrough: auditHeads.anchoredThrough })
        .from(auditHeads);
      const [first] = await readAuditEvents(tx, org, { limit: 1 });
      return {
        anchoredThrough: head?.anchoredThrough ?? null,
        firstDay: first ? first.occurredAt.slice(0, 10) : null,
      };
    },
  );
  let day = anchoredThrough ? nextDay(anchoredThrough) : firstDay;
  const anchored: string[] = [];
  while (day && day <= through) {
    await anchorDay(env, org, day);
    const done = day;
    await withOrg(env, orgId(org), (tx) =>
      tx
        .update(auditHeads)
        .set({ anchoredThrough: done })
        .where(eq(auditHeads.organizationId, org)),
    );
    anchored.push(day);
    day = nextDay(day);
  }
  return anchored;
};

// The cron job: every organization with a chain, live or deleted, through
// yesterday. A deleted organization stops after the day it was deleted.
export const anchorAll = async (env: Env, now: Date) => {
  const yesterday = dayOf(new Date(now.getTime() - DAY));
  const heads = await withoutOrg(
    env,
    "audit anchor: list every organization's chain",
    (tx) =>
      tx.execute<{ organization_id: string; deleted_at: Date | null }>(sql`
        select h.organization_id, d.deleted_at
          from audit_heads h left join deleted_organizations d using (organization_id)
         where h.anchored_through is null or h.anchored_through < ${yesterday}`),
  );
  const results = await Promise.allSettled(
    heads.rows.map((h) =>
      anchorOrganization(
        env,
        h.organization_id,
        h.deleted_at && dayOf(new Date(h.deleted_at)) < yesterday
          ? dayOf(new Date(h.deleted_at))
          : yesterday,
      ),
    ),
  );
  for (const [i, result] of results.entries())
    if (result.status === "rejected")
      console.error(
        JSON.stringify({
          job: "audit-anchor",
          organizationId: heads.rows[i]?.organization_id,
          error: String(result.reason),
        }),
      );
  return results;
};
