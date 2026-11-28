// Run capture read and export (design doc 10): one closed case's capture
// through the runtime's readCapture RPC, its review events from Postgres,
// and pages of an agent's closed cases streamed as NDJSON. Datasets reuse
// the export.

import { withOrg } from "@preprocess/db/client";
import type { OrgId, Tx } from "@preprocess/db/client";
import { cases, reviewEvents } from "@preprocess/db/schema/cases";
import { and, asc, count, eq, gt, gte, inArray, lt, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { agentRole, canSeeCase } from "./access.ts";
import type { OrgVariables } from "./caller.ts";
import { ApiError } from "./cases.ts";
import type { Env, RunCapture } from "./env.ts";

export const CLOSED = ["completed", "failed", "halted", "cancelled"] as const;
export type ClosedStatus = (typeof CLOSED)[number];

export const EXPORT_LIMIT_MAX = 500;
const READ_CONCURRENCY = 8;

export type ReviewEvent = {
  kind: string;
  path: string | null;
  before: unknown;
  after: unknown;
  checks: unknown;
  userId: string;
  at: string;
};

const caseColumns = {
  id: cases.id,
  agentId: cases.agentId,
  status: cases.status,
  deploymentId: cases.deploymentId,
  title: cases.title,
  createdAt: cases.createdAt,
  updatedAt: cases.updatedAt,
  completedAt: cases.completedAt,
  capturePurgedAt: cases.capturePurgedAt,
};
export type CaseRow = {
  [K in keyof typeof caseColumns]: (typeof cases.$inferSelect)[K];
};

const isClosed = (status: string): status is ClosedStatus =>
  (CLOSED as readonly string[]).includes(status);

// Retention deleted the capture since the case last closed; a rerun that
// closed after the purge stored a new one (retention.ts).
const purged = (row: CaseRow) => {
  if (!row.capturePurgedAt) return false;
  const closedAt = row.status === "cancelled" ? row.updatedAt : row.completedAt;
  return !closedAt || row.capturePurgedAt >= closedAt;
};

const runtime = (env: Env) => {
  if (!env.RUNTIME)
    throw new ApiError(503, "unavailable", "The case runtime is not running.");
  return env.RUNTIME;
};

const visibleCase = async (env: Env, vars: OrgVariables, caseId: string) => {
  const found = await withOrg(env, vars.org, async (tx) => {
    const [row] = await tx
      .select(caseColumns)
      .from(cases)
      .where(eq(cases.id, caseId));
    if (!row) return null;
    return { row, role: await agentRole(tx, vars.caller, row.agentId) };
  });
  if (!found || !canSeeCase(vars.caller, found.role))
    throw new ApiError(404, "not_found", "No such case.");
  return found.row;
};

// GET /cases/{id}/capture: the capture as stored.
export const readCaseCapture = async (
  env: Env,
  vars: OrgVariables,
  caseId: string,
): Promise<RunCapture> => {
  const row = await visibleCase(env, vars, caseId);
  if (!isClosed(row.status))
    throw new ApiError(
      409,
      "capture_not_ready",
      "The case is still running; its run capture is stored when it ends.",
    );
  if (purged(row))
    throw new ApiError(
      410,
      "capture_purged",
      "Retention deleted this case's run capture.",
    );
  const capture = await runtime(env).readCapture({
    organizationId: vars.org,
    agentId: row.agentId,
    caseId,
  });
  if (!capture)
    throw new ApiError(
      404,
      "capture_not_found",
      "This case has no run capture.",
    );
  return capture;
};

const toReviewEvent = (e: typeof reviewEvents.$inferSelect): ReviewEvent => ({
  kind: e.kind,
  path: e.path,
  before: e.before,
  after: e.after,
  checks: e.checks,
  userId: e.userId,
  at: e.at.toISOString(),
});

// Review events of these cases, oldest first, by case.
export const reviewEventsOf = async (tx: Tx, caseIds: string[]) => {
  const byCase = new Map<string, ReviewEvent[]>(caseIds.map((id) => [id, []]));
  if (!caseIds.length) return byCase;
  const rows = await tx
    .select()
    .from(reviewEvents)
    .where(inArray(reviewEvents.caseId, caseIds))
    .orderBy(asc(reviewEvents.at), asc(reviewEvents.id));
  for (const row of rows) byCase.get(row.caseId)?.push(toReviewEvent(row));
  return byCase;
};

// GET /cases/{id}/review-events.
export const caseReviewEvents = async (
  env: Env,
  vars: OrgVariables,
  caseId: string,
) => {
  await visibleCase(env, vars, caseId);
  return withOrg(
    env,
    vars.org,
    async (tx) => (await reviewEventsOf(tx, [caseId])).get(caseId) ?? [],
  );
};

export type ExportFilter = {
  from?: string | undefined;
  to?: string | undefined;
  status?: ClosedStatus[] | undefined;
  // Further conditions on the cases, such as a dataset's query.
  where?: (SQL | undefined)[];
};

// The agent's closed cases the filter selects.
export const closedCases = (agentId: string, filter: ExportFilter) =>
  and(
    eq(cases.agentId, agentId),
    inArray(cases.status, filter.status?.length ? filter.status : [...CLOSED]),
    filter.from ? gte(cases.createdAt, new Date(filter.from)) : undefined,
    filter.to ? lt(cases.createdAt, new Date(filter.to)) : undefined,
    ...(filter.where ?? []),
  );

// How many lines and skipped cases an export of every page holds together.
export const countClosedCases = async (
  tx: Tx,
  agentId: string,
  filter: ExportFilter,
) => {
  const [row] = await tx
    .select({ n: count() })
    .from(cases)
    .where(closedCases(agentId, filter));
  return row?.n ?? 0;
};

const decodeCursor = (cursor: string) => {
  try {
    const [at, id] = JSON.parse(atob(cursor)) as [unknown, unknown];
    if (
      typeof at === "string" &&
      typeof id === "string" &&
      !isNaN(Date.parse(at))
    )
      return { at: new Date(at), id };
  } catch {
    // reported below
  }
  throw new ApiError(400, "invalid_request", "Bad cursor.");
};

// One page of an agent's closed cases in createdAt order, and the cursor of
// the next page if there is one.
export const exportPage = async (
  tx: Tx,
  agentId: string,
  filter: ExportFilter,
  page: { cursor?: string | undefined; limit: number },
) => {
  const after = page.cursor ? decodeCursor(page.cursor) : null;
  const rows = await tx
    .select(caseColumns)
    .from(cases)
    .where(
      and(
        closedCases(agentId, filter),
        after
          ? or(
              gt(cases.createdAt, after.at),
              and(eq(cases.createdAt, after.at), gt(cases.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(asc(cases.createdAt), asc(cases.id))
    .limit(page.limit + 1);
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items,
    next:
      rows.length > page.limit && last
        ? btoa(JSON.stringify([last.createdAt.toISOString(), last.id]))
        : null,
  };
};

export type ExportItem = {
  case: {
    id: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    deploymentId: string;
    model: string | null;
  };
  capture: RunCapture | null;
  reviewEvents: ReviewEvent[];
};

export type ExportPage = {
  kept: CaseRow[];
  // Cases left out because retention deleted their capture.
  skipped: number;
  reviewEvents: Map<string, ReviewEvent[]>;
  next: string | null;
};

// The page's cases whose capture retention has not deleted, with their
// review events.
export const exportable = async (
  tx: Tx,
  page: { items: CaseRow[]; next: string | null },
): Promise<ExportPage> => {
  const kept = page.items.filter((row) => !purged(row));
  return {
    kept,
    skipped: page.items.length - kept.length,
    reviewEvents: await reviewEventsOf(
      tx,
      kept.map((row) => row.id),
    ),
    next: page.next,
  };
};

// Streams one line per kept case, as `line` maps it, then a trailer with
// the next page's cursor and how many of the page's cases were skipped.
// Captures are read a few at a time as the client pulls the lines.
export const streamExport = (
  env: Env,
  org: OrgId,
  page: ExportPage,
  line: (item: ExportItem) => unknown,
  filename: string,
) => {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= page.kept.length) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ next: page.next, skipped: page.skipped })}\n`,
          ),
        );
        controller.close();
        return;
      }
      const batch = page.kept.slice(i, i + READ_CONCURRENCY);
      i += batch.length;
      const captures = await Promise.all(
        batch.map((row) =>
          runtime(env).readCapture({
            organizationId: org,
            agentId: row.agentId,
            caseId: row.id,
          }),
        ),
      );
      const lines = batch.map((row, j) => {
        const capture = captures[j] ?? null;
        return `${JSON.stringify(
          line({
            case: {
              id: row.id,
              status: row.status,
              createdAt: row.createdAt.toISOString(),
              completedAt: row.completedAt?.toISOString() ?? null,
              deploymentId: row.deploymentId,
              model: capture?.model ?? null,
            },
            capture,
            reviewEvents: page.reviewEvents.get(row.id) ?? [],
          }),
        )}\n`;
      });
      controller.enqueue(encoder.encode(lines.join("")));
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
};
