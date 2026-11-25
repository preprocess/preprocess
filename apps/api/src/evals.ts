// Evals (design doc 09): every completed case joins its agent's automatic
// suite; a run replays a suite's cases against one deployment and one model
// as eval cases, and scores each one's answers field by field.

import { orgId, withOrg } from "@preprocess/db/client";
import type { OrgId, Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { reviewEvents } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import {
  DEFAULT_SUITE_CAP,
  evalResults,
  evalRuns,
  evalSuiteCases,
  evalSuites,
  type FieldScore,
} from "@preprocess/db/schema/evals";
import { currentModel } from "@preprocess/sdk/protocol";
import { and, asc, desc, eq, isNotNull, notInArray, sql } from "drizzle-orm";

import { agentGroups } from "./cases.ts";
import type { Manifest } from "./deploy.ts";
import { acceptedMemories } from "./memories.ts";
import type { Env, StartCase } from "./env.ts";
import type { OutboxMessage } from "./outbox.ts";
import { drainOutbox, readOutbox, writeOutbox } from "./outbox.ts";
import { effectiveSettings } from "./settings.ts";

// One schema field, by its dotted path in the answers.
export type SchemaField = { path: string };

// Compares one field. A model judge can implement this later without
// changing runs or storage.
export interface Scorer {
  score(
    field: SchemaField,
    expected: unknown,
    actual: unknown,
  ): { match: boolean; score: number };
}

const normalize = (value: unknown): unknown => {
  if (typeof value === "string")
    return value.trim().replace(/\s+/g, " ").toLowerCase();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, normalize(v)]),
    );
  return value;
};

// Strings and enums ignore case and surrounding or repeated whitespace;
// numbers and booleans match exactly; arrays and objects match deeply by the
// same rules.
export const fieldScorer: Scorer = {
  score(_field, expected, actual) {
    const match =
      JSON.stringify(normalize(expected)) === JSON.stringify(normalize(actual));
    return { match, score: match ? 1 : 0 };
  },
};

// The answers' fields: object keys flattened to dotted paths, arrays and
// scalars compared whole.
const leaves = (
  value: unknown,
  path = "",
): Array<{ path: string; value: unknown }> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
        leaves(v, path ? `${path}.${k}` : k),
      )
    : [{ path, value }];

const at = (value: unknown, path: string) =>
  path
    .split(".")
    .reduce<unknown>(
      (v, k) =>
        v && typeof v === "object"
          ? (v as Record<string, unknown>)[k]
          : undefined,
      value,
    );

export const scoreAnswers = (
  expected: Record<string, unknown> | null,
  actual: Record<string, unknown> | null,
  scorer: Scorer = fieldScorer,
): FieldScore[] =>
  expected
    ? leaves(expected).map(({ path, value }) => ({
        path,
        ...scorer.score({ path }, value, at(actual, path)),
      }))
    : [];

// "items[0].sku" → ["items", 0, "sku"], as the runtime writes paths.
const segments = (path: string) =>
  path.split(".").flatMap((part) => {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!match) return [part];
    return [
      match[1]!,
      ...[...(match[2] ?? "").matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])),
    ];
  });

const withValue = (root: unknown, path: string, value: unknown) => {
  const copy = structuredClone(root ?? {}) as Record<string | number, unknown>;
  const parts = segments(path);
  let target = copy;
  parts.forEach((part, i) => {
    if (i === parts.length - 1) {
      if (value === null || value === undefined) delete target[part];
      else target[part] = value;
      return;
    }
    target[part] ??= typeof parts[i + 1] === "number" ? [] : {};
    target = target[part] as Record<string | number, unknown>;
  });
  return copy;
};

// The agent's own answers: the final ones with every field a person changed
// put back to what it was before the first change.
const originalAnswers = async (
  tx: Tx,
  caseId: string,
  answers: Record<string, unknown> | null,
) => {
  if (!answers) return null;
  const changes = await tx
    .select({ path: reviewEvents.path, before: reviewEvents.before })
    .from(reviewEvents)
    .where(and(eq(reviewEvents.caseId, caseId), isNotNull(reviewEvents.path)))
    .orderBy(asc(reviewEvents.at));
  const seen = new Set<string>();
  let original: Record<string | number, unknown> = answers;
  for (const change of changes) {
    if (seen.has(change.path!)) continue;
    seen.add(change.path!);
    original = withValue(original, change.path!, change.before);
  }
  return original;
};

export type SuiteCaseSource = {
  caseId: string;
  input: StartCase["input"];
  answers: Record<string, unknown> | null;
  captureKey: string;
};

export const suiteCaseValues = async (
  tx: Tx,
  organizationId: string,
  suiteId: string,
  source: SuiteCaseSource,
) => ({
  organizationId,
  suiteId,
  caseId: source.caseId,
  input: source.input,
  expected: source.answers,
  original: await originalAnswers(tx, source.caseId, source.answers),
  captureKey: source.captureKey,
  addedAt: new Date(),
});

// A completed case joins its agent's automatic suite, which is created with
// the first one and keeps the newest `cap`. A case completing again after a
// Rerun replaces its entry.
export const joinAutomaticSuite = async (
  tx: Tx,
  organizationId: string,
  agentId: string,
  source: SuiteCaseSource,
) => {
  await tx
    .insert(evalSuites)
    .values({
      id: newId("evalSuite"),
      organizationId,
      agentId,
      name: "Completed cases",
      kind: "automatic",
      cap: DEFAULT_SUITE_CAP,
      createdBy: "platform",
    })
    .onConflictDoNothing();
  const [suite] = await tx
    .select({ id: evalSuites.id, cap: evalSuites.cap })
    .from(evalSuites)
    .where(
      and(eq(evalSuites.agentId, agentId), eq(evalSuites.kind, "automatic")),
    );
  const values = await suiteCaseValues(tx, organizationId, suite!.id, source);
  await tx
    .insert(evalSuiteCases)
    .values(values)
    .onConflictDoUpdate({
      target: [evalSuiteCases.suiteId, evalSuiteCases.caseId],
      set: values,
    });
  await trimSuite(tx, suite!.id, suite!.cap!);
};

export const trimSuite = async (tx: Tx, suiteId: string, cap: number) => {
  const keep = tx
    .select({ caseId: evalSuiteCases.caseId })
    .from(evalSuiteCases)
    .where(eq(evalSuiteCases.suiteId, suiteId))
    .orderBy(desc(evalSuiteCases.addedAt), desc(evalSuiteCases.caseId))
    .limit(cap);
  await tx
    .delete(evalSuiteCases)
    .where(
      and(
        eq(evalSuiteCases.suiteId, suiteId),
        notInArray(evalSuiteCases.caseId, keep),
      ),
    );
};

export const evalCaseId = (runId: string, caseId: string) =>
  `eval:${runId}:${caseId}`;

// Inside the request's transaction: one run per model, each with a result
// row per suite case and an outbox row that starts its eval case.
export const createRuns = async (
  tx: Tx,
  input: {
    organizationId: string;
    suiteId: string;
    deploymentId: string;
    models: string[];
    trigger: "manual" | "push";
    createdBy: string;
  },
) => {
  const suiteCases = await tx
    .select({ caseId: evalSuiteCases.caseId })
    .from(evalSuiteCases)
    .where(eq(evalSuiteCases.suiteId, input.suiteId));
  const [suite] = await tx
    .select({ agentId: evalSuites.agentId })
    .from(evalSuites)
    .where(eq(evalSuites.id, input.suiteId));
  const memories = suite ? await acceptedMemories(tx, suite.agentId) : [];
  const runs: string[] = [];
  const outboxRows: { id: string; kind: "eval.start" }[] = [];
  for (const model of input.models) {
    const id = newId("evalRun");
    runs.push(id);
    await tx.insert(evalRuns).values({
      id,
      organizationId: input.organizationId,
      suiteId: input.suiteId,
      deploymentId: input.deploymentId,
      model,
      trigger: input.trigger,
      memories,
      status: suiteCases.length ? "running" : "completed",
      cases: suiteCases.length,
      createdBy: input.createdBy,
      ...(suiteCases.length === 0 && { finishedAt: new Date() }),
    });
    for (const { caseId } of suiteCases) {
      await tx.insert(evalResults).values({
        organizationId: input.organizationId,
        runId: id,
        caseId,
        status: "running",
      });
      outboxRows.push({
        id: await writeOutbox(tx, input.organizationId, "eval.start", {
          runId: id,
          caseId,
        }),
        kind: "eval.start",
      });
    }
  }
  return { runs, outboxRows };
};

export const drainRuns = (
  env: Env,
  org: OrgId,
  rows: { id: string; kind: "eval.start" }[],
) => drainOutbox(env, org, rows);

// The CASES queue's consumer for "eval.start": resolves the deployment and
// the run's model, and starts the eval case in the runtime.
export const startQueuedEval = async (env: Env, message: OutboxMessage) => {
  const row = await readOutbox(env, message);
  if (!row) return;
  const { runId, caseId } = row.payload as { runId: string; caseId: string };
  const start = await withOrg(env, orgId(row.organizationId), async (tx) => {
    const [found] = await tx
      .select({
        status: evalResults.status,
        model: evalRuns.model,
        agentId: deployments.agentId,
        deploymentId: deployments.id,
        bundleSha256: deployments.bundleSha256,
        network: deployments.network,
        manifest: deployments.manifest,
        input: evalSuiteCases.input,
        captureKey: evalSuiteCases.captureKey,
        memories: evalRuns.memories,
      })
      .from(evalResults)
      .innerJoin(evalRuns, eq(evalRuns.id, evalResults.runId))
      .innerJoin(deployments, eq(deployments.id, evalRuns.deploymentId))
      .leftJoin(
        evalSuiteCases,
        and(
          eq(evalSuiteCases.suiteId, evalRuns.suiteId),
          eq(evalSuiteCases.caseId, evalResults.caseId),
        ),
      )
      .where(and(eq(evalResults.runId, runId), eq(evalResults.caseId, caseId)));
    if (!found || found.status !== "running") return null;
    if (!found.input || !found.captureKey) {
      await settle(tx, runId, caseId, {
        status: "error",
        reason: "the case was deleted",
      });
      return null;
    }
    const settings = await effectiveSettings(
      tx,
      found.agentId,
      found.manifest as Manifest,
    );
    return {
      organizationId: row.organizationId,
      agentId: found.agentId,
      caseId: evalCaseId(runId, caseId),
      deploymentId: found.deploymentId,
      bundleHash: found.bundleSha256,
      network: found.network,
      settings: { ...settings, model: currentModel(found.model) },
      input: found.input as StartCase["input"],
      groups: await agentGroups(tx, found.agentId),
      memories: found.memories ?? [],
      eval: { runId, sourceCaseId: caseId, captureKey: found.captureKey },
    } satisfies StartCase;
  });
  if (!start) return;
  if (!env.RUNTIME) throw new Error("The runtime Worker is not bound.");
  await env.RUNTIME.startCase(start);
};

// apps/runtime/src/env.ts EvalEvent.
export type EvalEvent = {
  organizationId: string;
  agentId: string;
  caseId: string;
  runId: string;
  sourceCaseId: string;
  status:
    "running" | "waiting" | "halted" | "completed" | "failed" | "cancelled";
  waitingOn: string | null;
  reason: string | null;
  answers: Record<string, unknown> | null;
  costMicroUsd: number;
  captureKey: string;
};

const settle = async (
  tx: Tx,
  runId: string,
  caseId: string,
  result: Partial<typeof evalResults.$inferInsert> & {
    status: "passed" | "failed" | "needed_person" | "error";
  },
) => {
  const [updated] = await tx
    .update(evalResults)
    .set({ ...result, finishedAt: new Date() })
    .where(
      and(
        eq(evalResults.runId, runId),
        eq(evalResults.caseId, caseId),
        eq(evalResults.status, "running"),
      ),
    )
    .returning({ cost: evalResults.costMicroUsd });
  if (!updated) return;
  const count = (status: string) =>
    sql<number>`count(*) filter (where ${evalResults.status} = ${status})::int`;
  const [tally] = await tx
    .select({
      running: count("running"),
      passed: count("passed"),
      neededPerson: count("needed_person"),
      failed: sql<number>`count(*) filter (where ${evalResults.status} in ('failed', 'error'))::int`,
      cost: sql<number>`coalesce(sum(${evalResults.costMicroUsd}), 0)::bigint`,
    })
    .from(evalResults)
    .where(eq(evalResults.runId, runId));
  await tx
    .update(evalRuns)
    .set({
      passed: tally!.passed,
      neededPerson: tally!.neededPerson,
      failed: tally!.failed,
      costMicroUsd: Number(tally!.cost),
      ...(tally!.running === 0 && {
        status: "completed",
        finishedAt: new Date(),
      }),
    })
    .where(eq(evalRuns.id, runId));
};

// What an eval case reports when it settles. A wait on a group ends it as
// needing a person; a failure, halt or cancellation is an error.
export const recordEvalEvent = (env: Env, event: EvalEvent) =>
  withOrg(env, orgId(event.organizationId), async (tx) => {
    if (event.caseId !== evalCaseId(event.runId, event.sourceCaseId)) return;
    if (event.status === "running") return;
    const common = {
      answers: event.answers,
      captureKey: event.captureKey,
      costMicroUsd: event.costMicroUsd,
    };
    if (event.status === "waiting")
      return settle(tx, event.runId, event.sourceCaseId, {
        ...common,
        status: "needed_person",
        reason: event.waitingOn ? `waited on ${event.waitingOn}` : event.reason,
      });
    if (event.status !== "completed")
      return settle(tx, event.runId, event.sourceCaseId, {
        ...common,
        status: "error",
        reason: event.reason ?? event.status,
      });
    const [suiteCase] = await tx
      .select({ expected: evalSuiteCases.expected })
      .from(evalSuiteCases)
      .innerJoin(evalRuns, eq(evalRuns.suiteId, evalSuiteCases.suiteId))
      .where(
        and(
          eq(evalRuns.id, event.runId),
          eq(evalSuiteCases.caseId, event.sourceCaseId),
        ),
      );
    if (!suiteCase)
      return settle(tx, event.runId, event.sourceCaseId, {
        ...common,
        status: "error",
        reason: "the case was deleted",
      });
    const fields = scoreAnswers(
      suiteCase.expected as Record<string, unknown> | null,
      event.answers,
    );
    return settle(tx, event.runId, event.sourceCaseId, {
      ...common,
      status: fields.every((f) => f.match) ? "passed" : "failed",
      fields,
      reason: null,
    });
  });
