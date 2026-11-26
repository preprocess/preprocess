// Evals (design doc 09): suites of completed cases, runs that replay them
// against one deployment and one model, and each eval case's scored result.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { agents } from "./access.ts";
import { organization } from "./auth.ts";
import { cases } from "./cases.ts";
import { deployments } from "./deployments.ts";

export const evalSuiteKind = pgEnum("eval_suite_kind", ["automatic", "manual"]);
export const evalRunTrigger = pgEnum("eval_run_trigger", ["manual", "push"]);
export const evalRunStatus = pgEnum("eval_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);
export const evalResultStatus = pgEnum("eval_result_status", [
  "running",
  "passed",
  "failed",
  "needed_person",
  "error",
]);

export const DEFAULT_SUITE_CAP = 100;

// One automatic suite per agent, created with its first completed case and
// capped at the newest `cap` cases; manual suites have no cap.
export const evalSuites = pgTable(
  "eval_suites",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    agentId: text().notNull(),
    name: text().notNull(),
    kind: evalSuiteKind().notNull(),
    cap: integer(),
    runOnPush: boolean().notNull().default(false),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("eval_suites_org_id_unique").on(t.organizationId, t.id),
    uniqueIndex("eval_suites_one_automatic")
      .on(t.organizationId, t.agentId)
      .where(sql`kind = 'automatic'`),
    check(
      "eval_suites_cap",
      sql`(${t.kind} = 'automatic') = (${t.cap} IS NOT NULL) AND (${t.cap} IS NULL OR ${t.cap} BETWEEN 1 AND 1000)`,
    ),
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
    }).onDelete("cascade"),
  ],
);

// What a case held when it joined: its input, the final answers a person may
// have corrected (expected) and the agent's own answers (original).
export const evalSuiteCases = pgTable(
  "eval_suite_cases",
  {
    organizationId: text().notNull(),
    suiteId: text().notNull(),
    caseId: text().notNull(),
    input: jsonb().notNull(),
    expected: jsonb(),
    original: jsonb(),
    captureKey: text().notNull(),
    addedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.suiteId, t.caseId] }),
    index().on(t.organizationId, t.suiteId, t.addedAt),
    foreignKey({
      columns: [t.organizationId, t.suiteId],
      foreignColumns: [evalSuites.organizationId, evalSuites.id],
    }).onDelete("cascade"),
    // Deleting a case removes it from every suite (spec 19).
    foreignKey({
      columns: [t.organizationId, t.caseId],
      foreignColumns: [cases.organizationId, cases.id],
    }).onDelete("cascade"),
  ],
);

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    suiteId: text().notNull(),
    deploymentId: text().notNull(),
    model: text().notNull(),
    trigger: evalRunTrigger().notNull(),
    status: evalRunStatus().notNull(),
    cases: integer().notNull().default(0),
    passed: integer().notNull().default(0),
    neededPerson: integer().notNull().default(0),
    failed: integer().notNull().default(0),
    costMicroUsd: bigint({ mode: "number" }).notNull().default(0),
    // The agent's accepted memory rules when the run started, which every
    // case of the run uses. Null on runs from before memory.
    memories: jsonb().$type<{ id: string; text: string }[]>(),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("eval_runs_org_id_unique").on(t.organizationId, t.id),
    index().on(t.organizationId, t.suiteId, t.createdAt),
    index().on(t.organizationId, t.createdAt),
    // A suite runs on push at most once per deployment.
    uniqueIndex("eval_runs_one_push")
      .on(t.suiteId, t.deploymentId)
      .where(sql`trigger = 'push'`),
    foreignKey({
      columns: [t.organizationId, t.suiteId],
      foreignColumns: [evalSuites.organizationId, evalSuites.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.deploymentId],
      foreignColumns: [deployments.organizationId, deployments.id],
    }).onDelete("cascade"),
  ],
);

export type FieldScore = { path: string; match: boolean; score: number };

// One eval case per suite case. case_id names the source case, which may be
// deleted since; the result stays with its run.
export const evalResults = pgTable(
  "eval_results",
  {
    organizationId: text().notNull(),
    runId: text().notNull(),
    caseId: text().notNull(),
    status: evalResultStatus().notNull(),
    fields: jsonb().$type<FieldScore[]>(),
    answers: jsonb(),
    reason: text(),
    captureKey: text(),
    costMicroUsd: bigint({ mode: "number" }).notNull().default(0),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.caseId] }),
    foreignKey({
      columns: [t.organizationId, t.runId],
      foreignColumns: [evalRuns.organizationId, evalRuns.id],
    }).onDelete("cascade"),
  ],
);
