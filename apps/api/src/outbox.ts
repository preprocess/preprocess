// The transactional outbox (design doc 04): work a transaction decides is
// written as an outbox row inside it, and handed to a queue once it commits.
// The queue message names the row, so payloads of any size stay in Postgres
// and a consumer reads the row it was sent. A row is drained once its queue
// send succeeded; the sweeper re-sends rows a failed send left behind.
//
// Each kind names its queue in `queues`. A kind without one stays undrained
// until its consumer exists.

import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
import type { OrgId, Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import type { outboxKind } from "@preprocess/db/schema/cases";
import { outbox } from "@preprocess/db/schema/cases";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import type { Env } from "./env.ts";

export type OutboxKind = (typeof outboxKind.enumValues)[number];

// What every outbox queue carries.
export type OutboxMessage = {
  organizationId: string;
  outboxId: string;
  kind: OutboxKind;
};

const queues: Partial<Record<OutboxKind, (env: Env) => Queue<OutboxMessage>>> =
  {
    "case.start": (env) => env.CASES,
    webhook: (env) => env.WEBHOOKS,
    email: (env) => env.EMAILS,
    "secret.sync": (env) => env.SECRET_SYNC,
  };

// Inside the transaction that decides the work.
export const writeOutbox = async (
  tx: Tx,
  organizationId: string,
  kind: OutboxKind,
  payload: Record<string, unknown>,
) => {
  const id = newId("outbox");
  await tx.insert(outbox).values({ id, organizationId, kind, payload });
  return id;
};

// Inside the transaction that changes what an agent's code is given (a
// secret's value, a secret or MCP grant): its live deployments rebind once
// that commits (design doc 03).
export const syncLater = async (
  tx: Tx,
  organizationId: string,
  agentIds: string[],
) => {
  const rows: { id: string; kind: OutboxKind }[] = [];
  for (const agentId of agentIds)
    rows.push({
      id: await writeOutbox(tx, organizationId, "secret.sync", { agentId }),
      kind: "secret.sync",
    });
  return rows;
};

type Row = { id: string; organizationId: string; kind: OutboxKind };

const send = async (env: Env, rows: Row[]) => {
  const sent: string[] = [];
  for (const row of rows) {
    const queue = queues[row.kind]?.(env);
    if (!queue) continue;
    try {
      await queue.send({
        organizationId: row.organizationId,
        outboxId: row.id,
        kind: row.kind,
      });
      sent.push(row.id);
    } catch (error) {
      console.error(
        JSON.stringify({
          job: "outbox",
          outboxId: row.id,
          error: String(error),
        }),
      );
    }
  }
  return sent;
};

// After the deciding transaction commits. A failed send is left for the
// sweeper; the caller's response does not depend on it.
export const drainOutbox = async (
  env: Env,
  org: OrgId,
  rows: { id: string; kind: OutboxKind }[],
) => {
  if (rows.length === 0) return;
  const sent = await send(
    env,
    rows.map((r) => ({ ...r, organizationId: org })),
  );
  await withOrg(env, org, async (tx) => {
    await tx
      .update(outbox)
      .set({ attempts: sql`${outbox.attempts} + 1` })
      .where(
        inArray(
          outbox.id,
          rows.map((r) => r.id),
        ),
      );
    if (sent.length)
      await tx
        .update(outbox)
        .set({ drainedAt: sql`now()` })
        .where(inArray(outbox.id, sent));
  });
};

// Every minute: rows still undrained a minute after they were written, in
// every organization.
export const sweepOutbox = async (env: Env) => {
  const rows = await withoutOrg(env, "outbox sweeper", (tx) =>
    tx
      .select({
        id: outbox.id,
        organizationId: outbox.organizationId,
        kind: outbox.kind,
      })
      .from(outbox)
      .where(
        and(
          isNull(outbox.drainedAt),
          lt(outbox.createdAt, sql`now() - interval '1 minute'`),
          inArray(outbox.kind, Object.keys(queues) as OutboxKind[]),
        ),
      )
      .orderBy(outbox.createdAt)
      .limit(500),
  );
  if (rows.length === 0) return;
  const sent = new Set(await send(env, rows));
  await withoutOrg(env, "outbox sweeper", async (tx) => {
    if (sent.size)
      await tx
        .update(outbox)
        .set({ drainedAt: sql`now()`, attempts: sql`${outbox.attempts} + 1` })
        .where(inArray(outbox.id, [...sent]));
    const failed = rows.filter((r) => !sent.has(r.id)).map((r) => r.id);
    if (failed.length)
      await tx
        .update(outbox)
        .set({ attempts: sql`${outbox.attempts} + 1` })
        .where(inArray(outbox.id, failed));
  });
};

// A consumer reads the row its message names, in that organization only.
export const readOutbox = (env: Env, message: OutboxMessage) =>
  withOrg(env, orgId(message.organizationId), async (tx) => {
    const [row] = await tx
      .select()
      .from(outbox)
      .where(
        and(eq(outbox.id, message.outboxId), eq(outbox.kind, message.kind)),
      );
    return row ?? null;
  });
