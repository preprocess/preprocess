// Run logs (design doc 09): every producer's records arrive through the LOGS
// queue, whose consumer writes them to the log store and keeps the Postgres
// summaries. The store is a Pipelines stream into an R2 Data Catalog table,
// queried with R2 SQL; local development and tests, which have neither, keep
// NDJSON objects in R2 behind the same interface.

import { orgId, withOrg } from "@preprocess/db/client";
import { logSummaries } from "@preprocess/db/schema/logs";
import type { LogLevel, LogRecord } from "@preprocess/logs";
import { sql } from "drizzle-orm";

import type { Env } from "./env.ts";

export type LogQuery = {
  organizationId: string;
  agentId?: string | undefined;
  deploymentId?: string | undefined;
  caseId?: string | undefined;
  level?: LogLevel | undefined;
  search?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  cursor?: string | undefined;
  limit: number;
};

export type LogPage = { records: LogRecord[]; cursor: string | null };

export interface LogStore {
  write(records: LogRecord[]): Promise<void>;
  query(q: LogQuery): Promise<LogPage>;
}

const DAY = 86_400_000;
const DEFAULT_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 31;
export const TABLE = "logs.run_logs";

const range = (q: LogQuery) => {
  const to = q.to ? new Date(q.to) : new Date();
  const earliest = to.getTime() - MAX_RANGE_DAYS * DAY;
  const from = q.from
    ? new Date(Math.max(Date.parse(q.from), earliest))
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY);
  return { from, to };
};

const matches = (q: LogQuery, r: LogRecord, from: string, to: string) => {
  if (r.organizationId !== q.organizationId) return false;
  if (q.agentId && r.agentId !== q.agentId) return false;
  if (q.deploymentId && r.deploymentId !== q.deploymentId) return false;
  if (q.caseId && r.caseId !== q.caseId) return false;
  if (q.level && r.level !== q.level) return false;
  if (r.at < from || r.at > to) return false;
  if (q.cursor && r.id >= q.cursor) return false;
  if (q.search) {
    const needle = q.search.toLowerCase();
    const hay = [r.message, r.data, r.error?.message ?? ""].join("\n");
    if (!hay.toLowerCase().includes(needle)) return false;
  }
  return true;
};

// {org}/{day}/{agent or _}/{case or _}/{first id}.ndjson
export const r2Store = (bucket: R2Bucket): LogStore => ({
  async write(records) {
    const groups = new Map<string, LogRecord[]>();
    for (const r of records) {
      const prefix = [
        r.organizationId,
        r.at.slice(0, 10),
        r.agentId ?? "_",
        r.caseId ?? "_",
      ].join("/");
      groups.set(prefix, [...(groups.get(prefix) ?? []), r]);
    }
    await Promise.all(
      [...groups].map(([prefix, group]) =>
        bucket.put(
          `${prefix}/${group[0]!.id}.ndjson`,
          group.map((r) => JSON.stringify(r)).join("\n"),
          { httpMetadata: { contentType: "application/x-ndjson" } },
        ),
      ),
    );
  },

  async query(q) {
    const { from, to } = range(q);
    const [fromIso, toIso] = [from.toISOString(), to.toISOString()];
    const found: LogRecord[] = [];
    // Newest day first; ids sort by time, so once a day yields enough the
    // older days cannot hold anything newer.
    for (
      let day = Date.UTC(
        to.getUTCFullYear(),
        to.getUTCMonth(),
        to.getUTCDate(),
      );
      day >= from.getTime() - DAY && found.length <= q.limit;
      day -= DAY
    ) {
      const parts = [
        q.organizationId,
        new Date(day).toISOString().slice(0, 10),
      ];
      if (q.agentId) parts.push(q.agentId, ...(q.caseId ? [q.caseId] : []));
      const prefix = `${parts.join("/")}/`;
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix, ...(cursor && { cursor }) });
        keys.push(...page.objects.map((o) => o.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      const wanted =
        q.caseId && !q.agentId
          ? keys.filter((k) => k.split("/")[3] === q.caseId)
          : keys;
      const bodies = await Promise.all(
        wanted.map(async (key) => (await bucket.get(key))?.text() ?? ""),
      );
      for (const line of bodies.join("\n").split("\n")) {
        if (!line) continue;
        const record = JSON.parse(line) as LogRecord;
        if (matches(q, record, fromIso, toIso)) found.push(record);
      }
    }
    found.sort((a, b) => (a.id < b.id ? 1 : -1));
    const records = found.slice(0, q.limit);
    return {
      records,
      cursor: found.length > q.limit ? records.at(-1)!.id : null,
    };
  },
});

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

const COLUMNS = [
  "id",
  "at",
  "organizationId",
  "agentId",
  "deploymentId",
  "caseId",
  "source",
  "level",
  "kind",
  "message",
  "durationMs",
  "traceId",
  "spanId",
  "error",
  "data",
] as const;

// The query R2 SQL runs. The organization always comes from the caller.
export const logSql = (q: LogQuery) => {
  const { from, to } = range(q);
  const where = [
    `"organizationId" = ${literal(q.organizationId)}`,
    `"at" >= ${literal(from.toISOString())}`,
    `"at" <= ${literal(to.toISOString())}`,
  ];
  const eq = (column: string, value: string | undefined) => {
    if (value) where.push(`"${column}" = ${literal(value)}`);
  };
  eq("agentId", q.agentId);
  eq("deploymentId", q.deploymentId);
  eq("caseId", q.caseId);
  eq("level", q.level);
  if (q.cursor) where.push(`"id" < ${literal(q.cursor)}`);
  if (q.search) {
    const like = literal(`%${q.search.toLowerCase()}%`);
    where.push(
      `(lower("message") LIKE ${like} OR lower("data") LIKE ${like} OR lower("error") LIKE ${like})`,
    );
  }
  return [
    `SELECT ${COLUMNS.map((c) => `"${c}"`).join(", ")} FROM ${TABLE}`,
    `WHERE ${where.join(" AND ")}`,
    `ORDER BY "id" DESC LIMIT ${q.limit + 1}`,
  ].join(" ");
};

// The stream's schema has error as a JSON string column.
type Row = Omit<LogRecord, "error"> & { error: string | null };

export const sqlStore = (env: Env): LogStore => ({
  async write(records) {
    if (!env.LOG_STREAM) throw new Error("LOG_STREAM is not bound");
    await env.LOG_STREAM.send(
      records.map((r): Row => ({
        ...r,
        error: r.error ? JSON.stringify(r.error) : null,
      })),
    );
  },

  async query(q) {
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.LOG_SQL_TOKEN || !env.LOG_SQL_BUCKET)
      throw new Error("R2 SQL is not configured");
    const response = await fetch(
      `https://api.sql.cloudflarestorage.com/api/v1/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/basin-sql/query/${env.LOG_SQL_BUCKET}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.LOG_SQL_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: logSql(q) }),
      },
    );
    if (!response.ok)
      throw new Error(
        `R2 SQL answered ${response.status}: ${await response.text()}`,
      );
    const body = await response.json<{ result?: { rows?: Row[] } }>();
    const rows = body.result?.rows ?? [];
    const records = rows.slice(0, q.limit).map((row): LogRecord => ({
      ...row,
      error: row.error ? (JSON.parse(row.error) as LogRecord["error"]) : null,
    }));
    return {
      records,
      cursor: rows.length > q.limit ? records.at(-1)!.id : null,
    };
  },
});

export const logStore = (env: Env): LogStore =>
  env.LOG_STORE === "sql" ? sqlStore(env) : r2Store(env.LOG_BUCKET);

// Queue messages are at most 100 per batch.
export const sendLogs = async (env: Env, records: LogRecord[]) => {
  for (let i = 0; i < records.length; i += 100)
    await env.LOGS.sendBatch(
      records.slice(i, i + 100).map((body) => ({ body })),
    );
};

type Tally = {
  organizationId: string;
  subjectKind: "case" | "deployment";
  subjectId: string;
  events: number;
  errors: number;
  warnings: number;
  lastError: { at: string; kind: string; message: string } | null;
  firstAt: string;
  lastAt: string;
};

const tallies = (records: LogRecord[]) => {
  const byKey = new Map<string, Tally>();
  for (const r of records) {
    const subjects = [
      ["case", r.caseId],
      ["deployment", r.deploymentId],
    ] as const;
    for (const [subjectKind, subjectId] of subjects) {
      if (!subjectId) continue;
      const key = `${r.organizationId}/${subjectKind}/${subjectId}`;
      const t = byKey.get(key) ?? {
        organizationId: r.organizationId,
        subjectKind,
        subjectId,
        events: 0,
        errors: 0,
        warnings: 0,
        lastError: null,
        firstAt: r.at,
        lastAt: r.at,
      };
      t.events++;
      if (r.level === "warn") t.warnings++;
      if (r.level === "error") {
        t.errors++;
        if (!t.lastError || r.at >= t.lastError.at)
          t.lastError = {
            at: r.at,
            kind: r.kind,
            message: r.error?.message ?? r.message,
          };
      }
      if (r.at < t.firstAt) t.firstAt = r.at;
      if (r.at > t.lastAt) t.lastAt = r.at;
      byKey.set(key, t);
    }
  }
  return [...byKey.values()];
};

const summarize = async (env: Env, organizationId: string, rows: Tally[]) =>
  withOrg(env, orgId(organizationId), (tx) =>
    tx
      .insert(logSummaries)
      .values(
        rows.map((t) => ({
          ...t,
          firstAt: new Date(t.firstAt),
          lastAt: new Date(t.lastAt),
        })),
      )
      .onConflictDoUpdate({
        target: [
          logSummaries.organizationId,
          logSummaries.subjectKind,
          logSummaries.subjectId,
        ],
        set: {
          events: sql`${logSummaries.events} + excluded.events`,
          errors: sql`${logSummaries.errors} + excluded.errors`,
          warnings: sql`${logSummaries.warnings} + excluded.warnings`,
          lastError: sql`CASE WHEN excluded.last_error IS NOT NULL AND (${logSummaries.lastError} IS NULL OR excluded.last_error->>'at' >= ${logSummaries.lastError}->>'at') THEN excluded.last_error ELSE ${logSummaries.lastError} END`,
          firstAt: sql`least(${logSummaries.firstAt}, excluded.first_at)`,
          lastAt: sql`greatest(${logSummaries.lastAt}, excluded.last_at)`,
        },
      }),
  );

// The LOGS queue's consumer. A failed store write retries the batch; an
// organization whose summaries cannot be written (deleted since) is skipped.
export const ingestLogs = async (env: Env, records: LogRecord[]) => {
  await logStore(env).write(records);
  const byOrg = new Map<string, Tally[]>();
  for (const t of tallies(records))
    byOrg.set(t.organizationId, [...(byOrg.get(t.organizationId) ?? []), t]);
  for (const [organizationId, rows] of byOrg) {
    try {
      await summarize(env, organizationId, rows);
    } catch (error) {
      console.error("log summaries", organizationId, error);
    }
  }
};
