// The only writer of audit events, and the chain verifier (design doc 02).
//
// hash_n = SHA-256(hash_{n-1} || JCS(event_n)), per organization, with a
// gap-free seq serialised by the organization's audit_heads row. Call audit()
// inside the transaction of the action it records.

import { and, asc, eq, gt, gte, lt, sql } from "drizzle-orm";

import type { Tx } from "./client.ts";
import { newId } from "./ids.ts";
import { auditEvents, auditHeads } from "./schema/audit.ts";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type AuditActorType = "person" | "agent" | "api_key" | "platform";

export type AuditInput = {
  organizationId: string;
  actorType: AuditActorType;
  actorId: string;
  action: string;
  onBehalfOf?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  caseId?: string | null;
  requestId?: string | null;
  ip?: string | null;
  // Ids, names and paths only; never answer values, file contents or secrets.
  data?: Record<string, Json>;
};

export type AuditBody = {
  organizationId: string;
  seq: number;
  id: string;
  occurredAt: string;
  actorType: AuditActorType;
  actorId: string;
  onBehalfOf: string | null;
  targetType: string | null;
  targetId: string | null;
  action: string;
  caseId: string | null;
  requestId: string | null;
  ip: string | null;
  data: Record<string, Json>;
};

export const ZERO_HASH = new Uint8Array(32);

// RFC 8785 JSON Canonicalization for the values audit events hold.
export const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("non-finite number in audit data");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
};

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const chainHash = async (
  prevHash: Uint8Array,
  body: AuditBody,
): Promise<Uint8Array> => {
  const encoded = new TextEncoder().encode(canonical(body));
  const input = new Uint8Array(prevHash.length + encoded.length);
  input.set(prevHash);
  input.set(encoded, prevHash.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
};

// RFC 3339 in UTC with microseconds, the same text Postgres gives back below.
const occurredAtText = sql<string>`to_char(${auditEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const ipText = sql<string | null>`host(${auditEvents.ip})`;

// Starts an organization's chain. Call once, in the transaction that creates
// the organization, before its first audit().
export const startAuditChain = async (tx: Tx, organizationId: string) => {
  await tx
    .insert(auditHeads)
    .values({ organizationId, seq: 0, hash: ZERO_HASH });
};

export const audit = async (tx: Tx, e: AuditInput): Promise<AuditBody> => {
  const [head] = await tx
    .select()
    .from(auditHeads)
    .where(eq(auditHeads.organizationId, e.organizationId))
    .for("update");
  if (!head)
    throw new Error(`no audit chain for organization ${e.organizationId}`);

  const ip = e.ip
    ? ((await tx.execute<{ ip: string }>(sql`select host(${e.ip}::inet) as ip`))
        .rows[0]?.ip ?? null)
    : null;
  const body: AuditBody = {
    organizationId: e.organizationId,
    seq: head.seq + 1,
    id: newId("audit"),
    occurredAt: new Date().toISOString().replace("Z", "000Z"),
    actorType: e.actorType,
    actorId: e.actorId,
    onBehalfOf: e.onBehalfOf ?? null,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    action: e.action,
    caseId: e.caseId ?? null,
    requestId: e.requestId ?? null,
    ip,
    data: e.data ?? {},
  };
  const hash = await chainHash(head.hash, body);
  await tx.insert(auditEvents).values({
    ...body,
    occurredAt: new Date(body.occurredAt),
    prevHash: head.hash,
    hash,
  });
  await tx
    .update(auditHeads)
    .set({ seq: body.seq, hash })
    .where(eq(auditHeads.organizationId, e.organizationId));
  return body;
};

export type AuditRow = AuditBody & { prevHash: Uint8Array; hash: Uint8Array };

export const readAuditEvents = async (
  tx: Tx,
  organizationId: string,
  range: { afterSeq?: number; from?: Date; to?: Date; limit?: number } = {},
): Promise<AuditRow[]> => {
  const rows = await tx
    .select({
      organizationId: auditEvents.organizationId,
      seq: auditEvents.seq,
      id: auditEvents.id,
      occurredAt: occurredAtText,
      actorType: auditEvents.actorType,
      actorId: auditEvents.actorId,
      onBehalfOf: auditEvents.onBehalfOf,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      action: auditEvents.action,
      caseId: auditEvents.caseId,
      requestId: auditEvents.requestId,
      ip: ipText,
      data: auditEvents.data,
      prevHash: auditEvents.prevHash,
      hash: auditEvents.hash,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, organizationId),
        range.afterSeq === undefined
          ? undefined
          : gt(auditEvents.seq, range.afterSeq),
        range.from ? gte(auditEvents.occurredAt, range.from) : undefined,
        range.to ? lt(auditEvents.occurredAt, range.to) : undefined,
      ),
    )
    .orderBy(asc(auditEvents.seq))
    .limit(range.limit ?? 1000);
  return rows as AuditRow[];
};

const bodyOf = ({ prevHash: _p, hash: _h, ...body }: AuditRow): AuditBody =>
  body;

export type ChainBreak = {
  seq: number;
  reason: "hash_mismatch" | "gap" | "anchor_mismatch" | "anchor_missing";
};

// Walks the chain in seq order from the start (or from the event before
// `from`) and recomputes every hash. Returns the first break, if any.
export const verifyAuditChain = async (
  tx: Tx,
  organizationId: string,
): Promise<{
  ok: boolean;
  checkedThroughSeq: number;
  headHash: Uint8Array;
  firstBreak?: ChainBreak;
}> => {
  let prevSeq = 0;
  let prevHash: Uint8Array = ZERO_HASH;
  for (;;) {
    const page = await readAuditEvents(tx, organizationId, {
      afterSeq: prevSeq,
      limit: 1000,
    });
    for (const row of page) {
      if (row.seq !== prevSeq + 1)
        return {
          ok: false,
          checkedThroughSeq: prevSeq,
          headHash: prevHash,
          firstBreak: { seq: prevSeq + 1, reason: "gap" },
        };
      const expected = await chainHash(prevHash, bodyOf(row));
      if (
        toHex(row.prevHash) !== toHex(prevHash) ||
        toHex(row.hash) !== toHex(expected)
      )
        return {
          ok: false,
          checkedThroughSeq: prevSeq,
          headHash: prevHash,
          firstBreak: { seq: row.seq, reason: "hash_mismatch" },
        };
      prevSeq = row.seq;
      prevHash = row.hash;
    }
    if (page.length < 1000) break;
  }
  const [head] = await tx
    .select()
    .from(auditHeads)
    .where(eq(auditHeads.organizationId, organizationId));
  if (head && (head.seq !== prevSeq || toHex(head.hash) !== toHex(prevHash)))
    return {
      ok: false,
      checkedThroughSeq: prevSeq,
      headHash: prevHash,
      firstBreak: { seq: prevSeq + 1, reason: "gap" },
    };
  return { ok: true, checkedThroughSeq: prevSeq, headHash: prevHash };
};
