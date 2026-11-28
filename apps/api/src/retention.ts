// Retention controls (spec 16a): per organization, documents, run capture, run
// logs and whole cases are kept forever (null, the default) or for N days
// after the case closes. Open cases are never touched; audit events never are.
//
// The daily sweep deletes in bounded batches, one transaction per batch: the
// batch's rows are locked, what lives outside Postgres (R2 objects, the case's
// Durable Object) is deleted, then the rows, and the counts are added to the
// organization's open retention_sweeps row for that kind. Once a kind has no
// more due (or its batches are used up), the open row becomes one
// retention.purged audit event. Every step is safe to repeat, and a sweep
// that stops partway is finished and audited by the next one.

import { audit } from "@preprocess/db/audit";
import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
import type { OrgId, Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { cases, files } from "@preprocess/db/schema/cases";
import { logSummaries } from "@preprocess/db/schema/logs";
import { agentMemories } from "@preprocess/db/schema/memories";
import {
  organizationRetention,
  RETENTION_KINDS,
  retentionSweeps,
} from "@preprocess/db/schema/retention";
import type { RetentionKind } from "@preprocess/db/schema/retention";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { actor, eventBase } from "./caller.ts";
import type { Caller, OrgVariables } from "./caller.ts";
import { ApiError } from "./cases.ts";
import type { Env } from "./env.ts";
import { logStore } from "./logs.ts";

export type RetentionPeriods = Record<RetentionKind, number | null>;

const DAY = 86_400_000;
// Cases (or files) per batch, and batches per organization and kind in one
// sweep; what is left waits for the next day's sweep.
export const BATCH = 50;
export const MAX_BATCHES = 20;

export const CLOSED = ["completed", "failed", "cancelled"] as const;

// When a case closed: its completion or failure, or for a cancelled case its
// cancellation, the last change it gets.
const closedAt = sql<Date>`(case when ${cases.status} = 'cancelled' then ${cases.updatedAt} else ${cases.completedAt} end)`;

const closedBefore = (org: OrgId, cutoff: Date) =>
  and(
    eq(cases.organizationId, org),
    inArray(cases.status, [...CLOSED]),
    sql`${closedAt} < ${cutoff.toISOString()}`,
  );

const periodsOf = (
  row: typeof organizationRetention.$inferSelect | undefined,
): RetentionPeriods => ({
  cases: row?.casesDays ?? null,
  documents: row?.documentsDays ?? null,
  runCapture: row?.runCaptureDays ?? null,
  runLogs: row?.runLogsDays ?? null,
});

export const readRetention = async (tx: Tx, org: OrgId) => {
  const [row] = await tx
    .select()
    .from(organizationRetention)
    .where(eq(organizationRetention.organizationId, org));
  return { periods: periodsOf(row), updatedAt: row?.updatedAt ?? null };
};

// Keeping forever is the longest period.
const shortens = (before: number | null, after: number | null) =>
  after !== null && (before === null || after < before);

// Only Owners shorten a period (or end keep-forever); Admins, and API keys,
// which act as Admin, may lengthen one. Every change is audited with its
// before and after values.
export const setRetention = async (
  tx: Tx,
  vars: OrgVariables,
  change: Partial<RetentionPeriods>,
) => {
  const { periods: before } = await readRetention(tx, vars.org);
  const after = { ...before, ...change };
  const changed = RETENTION_KINDS.filter((k) => before[k] !== after[k]);
  if (!changed.length) return;
  const shortened = changed.filter((k) => shortens(before[k], after[k]));
  if (shortened.length && vars.caller.role !== "owner")
    throw new ApiError(
      403,
      "forbidden",
      "Only Owners can shorten how long data is kept. Admins can lengthen it.",
    );
  const values = {
    casesDays: after.cases,
    documentsDays: after.documents,
    runCaptureDays: after.runCapture,
    runLogsDays: after.runLogs,
    updatedBy: actor(vars.caller).actorId,
    updatedAt: new Date(),
  };
  await tx
    .insert(organizationRetention)
    .values({ organizationId: vars.org, ...values })
    .onConflictDoUpdate({
      target: organizationRetention.organizationId,
      set: values,
    });
  await audit(tx, {
    ...eventBase(vars),
    action: "retention.updated",
    targetType: "organization",
    targetId: vars.org,
    data: { before, after, shortened },
  });
};

export const requireOwner = (caller: Caller) => {
  if (caller.type !== "person" || caller.role !== "owner")
    throw new ApiError(403, "forbidden", "Only Owners can delete a case.");
};

// R2 keys an organization's rows name always start with its id (spec 15);
// anything else is refused rather than deleted.
const deleteObjects = async (bucket: R2Bucket, org: OrgId, keys: string[]) => {
  const foreign = keys.find((k) => !k.startsWith(`${org}/`));
  if (foreign)
    throw new Error(`refusing to delete ${foreign} for organization ${org}`);
  for (let i = 0; i < keys.length; i += 1000)
    await bucket.delete(keys.slice(i, i + 1000));
};

// What retention reads of a case to find its objects and logs.
export const caseRef = {
  id: cases.id,
  agentId: cases.agentId,
  createdAt: cases.createdAt,
  closedAt,
};
type CaseRef = { id: string; agentId: string; createdAt: Date; closedAt: Date };

// A case's run logs: the log store's records where it can delete them (the
// R2 NDJSON store, not the Iceberg table; see logs.ts), and the cases'
// Postgres summaries.
const purgeLogs = async (env: Env, tx: Tx, org: OrgId, due: CaseRef[]) => {
  const store = logStore(env);
  let objects: number | null = 0;
  for (const c of due) {
    const n = await store.purgeCase({
      organizationId: org,
      agentId: c.agentId,
      caseId: c.id,
      from: c.createdAt,
      to: new Date(c.closedAt),
    });
    objects = n === null || objects === null ? null : objects + n;
  }
  const summaries = await tx.delete(logSummaries).where(
    and(
      eq(logSummaries.subjectKind, "case"),
      inArray(
        logSummaries.subjectId,
        due.map((c) => c.id),
      ),
    ),
  );
  return {
    summaries: summaries.rowCount ?? 0,
    ...(objects !== null && { logObjects: objects }),
  };
};

// Deletes closed cases whole: their files in R2, their Durable Object and run
// capture, their run logs, then the rows. Review events, approvals, mentions,
// assignees, webhook deliveries and eval suite membership go with the case
// row (spec 16a), and so do the rules the agent proposed on it, whatever their
// status, except accepted ones. Audit events, eval results and accepted
// memories stay.
export const deleteCases = async (
  env: Env,
  tx: Tx,
  org: OrgId,
  due: CaseRef[],
) => {
  const ids = due.map((c) => c.id);
  const keys = (
    await tx
      .select({ r2Key: files.r2Key })
      .from(files)
      .where(inArray(files.caseId, ids))
  ).map((f) => f.r2Key);
  await deleteObjects(env.FILES, org, keys);
  await Promise.all(
    due.map((c) =>
      env.RUNTIME.deleteCase({
        organizationId: org,
        agentId: c.agentId,
        caseId: c.id,
      }),
    ),
  );
  const logs = await purgeLogs(env, tx, org, due);
  const memories = await tx
    .delete(agentMemories)
    .where(
      and(
        inArray(agentMemories.caseId, ids),
        ne(agentMemories.status, "accepted"),
      ),
    );
  await tx.delete(cases).where(inArray(cases.id, ids));
  return {
    cases: ids.length,
    files: keys.length,
    memories: memories.rowCount ?? 0,
    ...logs,
  };
};

type Purged = { taken: number; counts: Record<string, number> } | null;

// One batch of one kind, inside the organization's transaction.
const purgers: Record<
  RetentionKind,
  (env: Env, tx: Tx, org: OrgId, cutoff: Date) => Promise<Purged>
> = {
  // Closed cases, and memory rules deleted before the cutoff: a deleted rule
  // keeps its text until then, even when its case is kept or already gone.
  async cases(env, tx, org, cutoff) {
    const due = await tx
      .select(caseRef)
      .from(cases)
      .where(closedBefore(org, cutoff))
      .orderBy(asc(cases.id))
      .limit(BATCH)
      .for("update");
    const rules = await tx
      .select({ id: agentMemories.id })
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.organizationId, org),
          eq(agentMemories.status, "deleted"),
          lt(agentMemories.deletedAt, cutoff),
        ),
      )
      .orderBy(asc(agentMemories.id))
      .limit(BATCH)
      .for("update");
    if (!due.length && !rules.length) return null;
    const counts = due.length
      ? await deleteCases(env, tx, org, due)
      : { memories: 0 };
    await tx.delete(agentMemories).where(
      inArray(
        agentMemories.id,
        rules.map((r) => r.id),
      ),
    );
    return {
      taken: Math.max(due.length, rules.length),
      counts: { ...counts, memories: counts.memories + rules.length },
    };
  },

  async documents(env, tx, org, cutoff) {
    const due = await tx
      .select({ id: files.id, r2Key: files.r2Key, size: files.size })
      .from(files)
      .innerJoin(cases, eq(cases.id, files.caseId))
      .where(and(eq(files.organizationId, org), closedBefore(org, cutoff)))
      .orderBy(asc(files.id))
      .limit(BATCH)
      .for("update", { of: files });
    if (!due.length) return null;
    await deleteObjects(
      env.FILES,
      org,
      due.map((f) => f.r2Key),
    );
    await tx.delete(files).where(
      inArray(
        files.id,
        due.map((f) => f.id),
      ),
    );
    return {
      taken: due.length,
      counts: {
        files: due.length,
        bytes: due.reduce((sum, f) => sum + f.size, 0),
      },
    };
  },

  // A rerun closes the case again, which makes its new capture due.
  async runCapture(env, tx, org, cutoff) {
    const due = await tx
      .select({ id: cases.id, agentId: cases.agentId })
      .from(cases)
      .where(
        and(
          closedBefore(org, cutoff),
          or(
            isNull(cases.capturePurgedAt),
            sql`${cases.capturePurgedAt} < ${closedAt}`,
          ),
        ),
      )
      .orderBy(asc(cases.id))
      .limit(BATCH)
      .for("update");
    if (!due.length) return null;
    await Promise.all(
      due.map((c) =>
        env.RUNTIME.deleteCapture({
          organizationId: org,
          agentId: c.agentId,
          caseId: c.id,
        }),
      ),
    );
    await tx
      .update(cases)
      .set({ capturePurgedAt: new Date() })
      .where(
        inArray(
          cases.id,
          due.map((c) => c.id),
        ),
      );
    return { taken: due.length, counts: { cases: due.length } };
  },

  // A rerun closes the case again, which makes its new logs due.
  async runLogs(env, tx, org, cutoff) {
    const due = await tx
      .select(caseRef)
      .from(cases)
      .where(
        and(
          closedBefore(org, cutoff),
          or(
            isNull(cases.logsPurgedAt),
            sql`${cases.logsPurgedAt} < ${closedAt}`,
          ),
        ),
      )
      .orderBy(asc(cases.id))
      .limit(BATCH)
      .for("update");
    if (!due.length) return null;
    const logs = await purgeLogs(env, tx, org, due);
    await tx
      .update(cases)
      .set({ logsPurgedAt: new Date() })
      .where(
        inArray(
          cases.id,
          due.map((c) => c.id),
        ),
      );
    return { taken: due.length, counts: { cases: due.length, ...logs } };
  },
};

const openSweep = (tx: Tx, org: OrgId, kind: RetentionKind) =>
  tx
    .select()
    .from(retentionSweeps)
    .where(
      and(
        eq(retentionSweeps.organizationId, org),
        eq(retentionSweeps.kind, kind),
        isNull(retentionSweeps.auditedAt),
      ),
    )
    .for("update");

const addToSweep = async (
  tx: Tx,
  org: OrgId,
  kind: RetentionKind,
  days: number,
  cutoff: Date,
  counts: Record<string, number>,
) => {
  const [open] = await openSweep(tx, org, kind);
  if (!open) {
    await tx.insert(retentionSweeps).values({
      id: newId("retentionSweep"),
      organizationId: org,
      kind,
      days,
      cutoff,
      counts,
    });
    return;
  }
  const total = { ...open.counts };
  for (const [key, n] of Object.entries(counts))
    total[key] = (total[key] ?? 0) + n;
  await tx
    .update(retentionSweeps)
    .set({ days, cutoff, counts: total })
    .where(eq(retentionSweeps.id, open.id));
};

// The one retention.purged event for what the open sweep deleted: the period,
// the cutoff and counts, never the objects.
const closeSweep = async (tx: Tx, org: OrgId, kind: RetentionKind) => {
  const [open] = await openSweep(tx, org, kind);
  if (!open) return;
  await audit(tx, {
    organizationId: org,
    actorType: "platform",
    actorId: "retention",
    action: "retention.purged",
    targetType: "organization",
    targetId: org,
    data: {
      kind,
      days: open.days,
      cutoff: open.cutoff.toISOString(),
      counts: open.counts,
    },
  });
  await tx
    .update(retentionSweeps)
    .set({ auditedAt: new Date() })
    .where(eq(retentionSweeps.id, open.id));
};

const sweepKind = async (
  env: Env,
  org: OrgId,
  kind: RetentionKind,
  days: number | null,
  now: Date,
) => {
  if (days !== null) {
    const cutoff = new Date(now.getTime() - days * DAY);
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const taken = await withOrg(env, org, async (tx) => {
        const purged = await purgers[kind](env, tx, org, cutoff);
        if (purged)
          await addToSweep(tx, org, kind, days, cutoff, purged.counts);
        return purged?.taken ?? 0;
      });
      if (taken < BATCH) break;
    }
  }
  await withOrg(env, org, (tx) => closeSweep(tx, org, kind));
};

// The daily sweep, from the API's 00:20 UTC cron: organizations with a
// period, and any whose earlier sweep stopped before its audit event.
export const sweepRetention = async (env: Env, now = new Date()) => {
  const { periods, open } = await withoutOrg(
    env,
    "retention sweep: every organization's retention periods and open sweeps",
    async (tx) => ({
      periods: await tx
        .select()
        .from(organizationRetention)
        .where(
          or(
            isNotNull(organizationRetention.casesDays),
            isNotNull(organizationRetention.documentsDays),
            isNotNull(organizationRetention.runCaptureDays),
            isNotNull(organizationRetention.runLogsDays),
          ),
        ),
      open: await tx
        .selectDistinct({
          organizationId: retentionSweeps.organizationId,
          kind: retentionSweeps.kind,
        })
        .from(retentionSweeps)
        .where(isNull(retentionSweeps.auditedAt)),
    }),
  );
  const work = new Map(
    periods.map((row) => [row.organizationId, periodsOf(row)]),
  );
  for (const row of open)
    if (!work.has(row.organizationId))
      work.set(row.organizationId, periodsOf(undefined));
  for (const [organizationId, settings] of work)
    for (const kind of RETENTION_KINDS) {
      const unaudited = open.some(
        (o) => o.organizationId === organizationId && o.kind === kind,
      );
      if (settings[kind] === null && !unaudited) continue;
      try {
        await sweepKind(env, orgId(organizationId), kind, settings[kind], now);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "retention.failed",
            organizationId,
            kind,
            error: String(error),
          }),
        );
      }
    }
};
