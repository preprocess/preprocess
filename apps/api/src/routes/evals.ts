// Eval suites and runs (design doc 09). Owners, Admins and the Developers
// group manage suites and start runs; results are informational.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import {
  evalResults,
  evalRuns,
  evalSuiteCases,
  evalSuites,
} from "@preprocess/db/schema/evals";
import { and, asc, count, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { actor, eventBase, requireDeveloper } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import type { Manifest } from "../deploy.ts";
import type { Env, StartCase } from "../env.ts";
import {
  createRuns,
  drainRuns,
  suiteCaseValues,
  trimSuite,
  type SuiteCaseSource,
} from "../evals.ts";
import { effectiveSettings } from "../settings.ts";
import { refuseOverLimit } from "../spend.ts";

const OrgParam = z.object({ org: z.string() });
const AgentParam = OrgParam.extend({ agent: z.string() });
const SuiteParam = OrgParam.extend({ suite: z.string() });
const RunParam = OrgParam.extend({ run: z.string() });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});

const Run = z
  .object({
    id: z.string(),
    suiteId: z.string(),
    deploymentId: z.string(),
    model: z.string(),
    trigger: z.enum(["manual", "push"]),
    status: z.enum(["queued", "running", "completed", "failed"]),
    cases: z.number(),
    passed: z.number(),
    neededPerson: z.number(),
    failed: z.number(),
    passRate: z.number().nullable().openapi({
      description: "Passed over finished cases; null until one finishes",
    }),
    costUsd: z.number(),
    createdBy: z.string(),
    createdAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .openapi("EvalRun");

const Suite = z
  .object({
    id: z.string(),
    agentId: z.string(),
    name: z.string(),
    kind: z.enum(["automatic", "manual"]),
    cap: z.number().nullable(),
    runOnPush: z.boolean(),
    cases: z.number(),
    latestRun: Run.nullable(),
    createdAt: z.string(),
  })
  .openapi("EvalSuite");

const SuiteCase = z
  .object({
    caseId: z.string(),
    input: z.unknown(),
    expected: z.unknown(),
    original: z.unknown(),
    addedAt: z.string(),
  })
  .openapi("EvalSuiteCase");

const FieldScore = z.object({
  path: z.string(),
  match: z.boolean(),
  score: z.number(),
});

const Result = z
  .object({
    caseId: z.string(),
    status: z.enum(["running", "passed", "failed", "needed_person", "error"]),
    fields: z.array(FieldScore).nullable(),
    answers: z.unknown(),
    reason: z.string().nullable(),
    costUsd: z.number(),
  })
  .openapi("EvalResult");

const RunDetail = Run.extend({
  fields: z.array(z.object({ path: z.string(), matchRate: z.number() })),
  results: z.array(Result),
}).openapi("EvalRunDetail");

const usd = (micro: number) => micro / 1_000_000;

const runView = (r: typeof evalRuns.$inferSelect) => {
  const finished = r.passed + r.failed + r.neededPerson;
  return {
    id: r.id,
    suiteId: r.suiteId,
    deploymentId: r.deploymentId,
    model: r.model,
    trigger: r.trigger,
    status: r.status,
    cases: r.cases,
    passed: r.passed,
    neededPerson: r.neededPerson,
    failed: r.failed,
    passRate: finished ? r.passed / finished : null,
    costUsd: usd(r.costMicroUsd),
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
};

const findAgent = async (tx: Tx, slug: string) => {
  const [agent] = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.slug, slug));
  if (!agent) throw new ApiError(404, "not_found", "No such agent.");
  return agent;
};

const findSuite = async (tx: Tx, id: string) => {
  const [suite] = await tx
    .select()
    .from(evalSuites)
    .where(eq(evalSuites.id, id));
  if (!suite) throw new ApiError(404, "not_found", "No such eval suite.");
  return suite;
};

const suiteView = async (tx: Tx, suite: typeof evalSuites.$inferSelect) => {
  const [size] = await tx
    .select({ n: count() })
    .from(evalSuiteCases)
    .where(eq(evalSuiteCases.suiteId, suite.id));
  const [latest] = await tx
    .select()
    .from(evalRuns)
    .where(eq(evalRuns.suiteId, suite.id))
    .orderBy(desc(evalRuns.createdAt))
    .limit(1);
  return {
    id: suite.id,
    agentId: suite.agentId,
    name: suite.name,
    kind: suite.kind,
    cap: suite.cap,
    runOnPush: suite.runOnPush,
    cases: size?.n ?? 0,
    latestRun: latest ? runView(latest) : null,
    createdAt: suite.createdAt.toISOString(),
  };
};

export const evalRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/agents/{agent}/eval-suites",
      tags: ["Evals"],
      summary: "An agent's eval suites (Developers and Admins)",
      request: { params: AgentParam },
      responses: { 200: json(z.object({ suites: z.array(Suite) }), "Suites") },
    }),
    async (c) => {
      const { agent: slug } = c.req.valid("param");
      const suites = await withOrg(c.env, c.var.org, async (tx) => {
        await requireDeveloper(tx, c.var.caller);
        const agent = await findAgent(tx, slug);
        const rows = await tx
          .select()
          .from(evalSuites)
          .where(eq(evalSuites.agentId, agent.id))
          .orderBy(asc(evalSuites.kind), asc(evalSuites.createdAt));
        return Promise.all(rows.map((s) => suiteView(tx, s)));
      });
      return c.json({ suites }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/agents/{agent}/eval-suites",
      tags: ["Evals"],
      summary: "Create a manual eval suite (Developers and Admins)",
      request: {
        params: AgentParam,
        ...body(
          z
            .object({
              name: z.string().trim().min(1).max(100),
              runOnPush: z.boolean().optional(),
            })
            .strict(),
        ),
      },
      responses: { 201: json(Suite, "The suite") },
    }),
    async (c) => {
      const { agent: slug } = c.req.valid("param");
      const input = c.req.valid("json");
      const suite = await withOrg(c.env, c.var.org, async (tx) => {
        await requireDeveloper(tx, c.var.caller);
        const agent = await findAgent(tx, slug);
        const [row] = await tx
          .insert(evalSuites)
          .values({
            id: newId("evalSuite"),
            organizationId: c.var.org,
            agentId: agent.id,
            name: input.name,
            kind: "manual",
            runOnPush: input.runOnPush ?? false,
            createdBy: actor(c.var.caller).actorId,
          })
          .returning();
        await audit(tx, {
          ...eventBase(c.var),
          action: "eval_suite.created",
          targetType: "eval_suite",
          targetId: row!.id,
          data: { agent: agent.id, name: input.name },
        });
        return suiteView(tx, row!);
      });
      return c.json(suite, 201);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/eval-suites/{suite}",
      tags: ["Evals"],
      summary: "An eval suite with its cases and recent runs",
      request: { params: SuiteParam },
      responses: {
        200: json(
          Suite.extend({
            suiteCases: z.array(SuiteCase),
            runs: z.array(Run),
          }),
          "The suite",
        ),
      },
    }),
    async (c) => {
      const { suite: id } = c.req.valid("param");
      const view = await withOrg(c.env, c.var.org, async (tx) => {
        await requireDeveloper(tx, c.var.caller);
        const suite = await findSuite(tx, id);
        const rows = await tx
          .select()
          .from(evalSuiteCases)
          .where(eq(evalSuiteCases.suiteId, id))
          .orderBy(desc(evalSuiteCases.addedAt));
        const runs = await tx
          .select()
          .from(evalRuns)
          .where(eq(evalRuns.suiteId, id))
          .orderBy(desc(evalRuns.createdAt))
          .limit(50);
        return {
          ...(await suiteView(tx, suite)),
          suiteCases: rows.map((r) => ({
            caseId: r.caseId,
            input: r.input,
            expected: r.expected,
            original: r.original,
            addedAt: r.addedAt.toISOString(),
          })),
          runs: runs.map(runView),
        };
      });
      return c.json(view, 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/eval-suites/{suite}",
      tags: ["Evals"],
      summary:
        "Rename a suite, set the automatic suite's cap (1-1000), or mark it to run on push",
      request: {
        params: SuiteParam,
        ...body(
          z
            .object({
              name: z.string().trim().min(1).max(100).optional(),
              cap: z.number().int().min(1).max(1000).optional(),
              runOnPush: z.boolean().optional(),
            })
            .strict(),
        ),
      },
      responses: { 200: json(Suite, "The suite") },
    }),
    async (c) => {
      const { suite: id } = c.req.valid("param");
      const input = c.req.valid("json");
      const view = await withOrg(c.env, c.var.org, async (tx) => {
        await requireDeveloper(tx, c.var.caller);
        const suite = await findSuite(tx, id);
        if (input.cap !== undefined && suite.kind !== "automatic")
          throw new ApiError(
            400,
            "invalid_request",
            "Only the automatic suite has a cap.",
          );
        const [row] = await tx
          .update(evalSuites)
          .set(input)
          .where(eq(evalSuites.id, id))
          .returning();
        if (input.cap !== undefined) await trimSuite(tx, id, input.cap);
        await audit(tx, {
          ...eventBase(c.var),
          action: "eval_suite.updated",
          targetType: "eval_suite",
          targetId: id,
          data: {
            before: {
              name: suite.name,
              cap: suite.cap,
              runOnPush: suite.runOnPush,
            },
            after: {
              name: row!.name,
              cap: row!.cap,
              runOnPush: row!.runOnPush,
            },
          },
        });
        return suiteView(tx, row!);
      });
      return c.json(view, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/eval-suites/{suite}",
      tags: ["Evals"],
      summary: "Delete a manual suite and its runs",
      request: { params: SuiteParam },
      responses: { 204: { description: "Deleted" } },
    }),
    async (c) => {
      const { suite: id } = c.req.valid("param");
      await withOrg(c.env, c.var.org, async (tx) => {
        await requireDeveloper(tx, c.var.caller);
        const suite = await findSuite(tx, id);
        if (suite.kind === "automatic")
          throw new ApiError(
            409,
            "conflict",
            "The automatic suite cannot be deleted; lower its cap instead.",
          );
        await tx.delete(evalSuites).where(eq(evalSuites.id, id));
        await audit(tx, {
          ...eventBase(c.var),
          action: "eval_suite.deleted",
          targetType: "eval_suite",
          targetId: id,
          data: { name: suite.name },
        });
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/eval-suites/{suite}/cases",
      tags: ["Evals"],
      summary: "Add completed cases of the suite's agent to a manual suite",
      request: {
        params: SuiteParam,
        ...body(
          z.object({ cases: z.array(z.string()).min(1).max(100) }).strict(),
        ),
      },
      responses: { 200: json(Suite, "The suite") },
    }),
    async (c) => {
      const { suite: id } = c.req.valid("param");
      const { cases: ids } = c.req.valid("json");
      const org = c.var.org;
      const { suite, found } = await withOrg(c.env, org, async (tx) => {
        await requireDeveloper(tx, c.var.caller);
        const suite = await findSuite(tx, id);
        if (suite.kind !== "manual")
          throw new ApiError(
            400,
            "invalid_request",
            "Completed cases join the automatic suite on their own.",
          );
        const found = await tx
          .select({ id: cases.id })
          .from(cases)
          .where(
            and(
              inArray(cases.id, ids),
              eq(cases.agentId, suite.agentId),
              eq(cases.status, "completed"),
            ),
          );
        if (found.length !== new Set(ids).size)
          throw new ApiError(
            400,
            "invalid_request",
            "Only the agent's completed cases can join a suite.",
          );
        return { suite, found };
      });
      // The runtime holds each case's input and answers; read them outside
      // the transaction.
      const sources: SuiteCaseSource[] = [];
      for (const { id: caseId } of found) {
        const key = {
          organizationId: org,
          agentId: suite.agentId,
          caseId,
        };
        const view = (await c.env.RUNTIME.getCase(key)) as {
          captureKey: string;
          capture: { kind: string; data: { input?: StartCase["input"] } }[];
        };
        const state = await c.env.RUNTIME.caseState(key);
        const started = view.capture.find((e) => e.kind === "case.started");
        sources.push({
          caseId,
          input: started?.data.input ?? { text: "" },
          answers: state.answers,
          captureKey: view.captureKey,
        });
      }
      const view = await withOrg(c.env, org, async (tx) => {
        for (const source of sources) {
          const values = await suiteCaseValues(tx, org, id, source);
          await tx
            .insert(evalSuiteCases)
            .values(values)
            .onConflictDoUpdate({
              target: [evalSuiteCases.suiteId, evalSuiteCases.caseId],
              set: values,
            });
        }
        await audit(tx, {
          ...eventBase(c.var),
          action: "eval_suite.cases_added",
          targetType: "eval_suite",
          targetId: id,
          data: { cases: sources.map((s) => s.caseId) },
        });
        return suiteView(tx, await findSuite(tx, id));
      });
      return c.json(view, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/eval-suites/{suite}/cases",
      tags: ["Evals"],
      summary: "Remove cases from a suite",
      request: {
        params: SuiteParam,
        ...body(
          z.object({ cases: z.array(z.string()).min(1).max(1000) }).strict(),
        ),
      },
      responses: { 200: json(Suite, "The suite") },
    }),
    async (c) => {
      const { suite: id } = c.req.valid("param");
      const { cases: ids } = c.req.valid("json");
      const view = await withOrg(c.env, c.var.org, async (tx) => {
        await requireDeveloper(tx, c.var.caller);
        const suite = await findSuite(tx, id);
        await tx
          .delete(evalSuiteCases)
          .where(
            and(
              eq(evalSuiteCases.suiteId, id),
              inArray(evalSuiteCases.caseId, ids),
            ),
          );
        await audit(tx, {
          ...eventBase(c.var),
          action: "eval_suite.cases_removed",
          targetType: "eval_suite",
          targetId: id,
          data: { cases: ids },
        });
        return suiteView(tx, suite);
      });
      return c.json(view, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/eval-suites/{suite}/runs",
      tags: ["Evals"],
      summary:
        "Run a suite against a deployment (production by default), one run per model",
      request: {
        params: SuiteParam,
        ...body(
          z
            .object({
              deployment: z.string().optional(),
              models: z.array(z.string().min(1)).min(1).max(5).optional(),
            })
            .strict(),
        ),
      },
      responses: {
        202: json(z.object({ runs: z.array(Run) }), "Runs started"),
      },
    }),
    async (c) => {
      const { suite: id } = c.req.valid("param");
      const input = c.req.valid("json");
      const org = c.var.org;
      const { runs, outboxRows } = await withOrg(c.env, org, async (tx) => {
        await requireDeveloper(tx, c.var.caller);
        await refuseOverLimit(tx);
        const suite = await findSuite(tx, id);
        const select = () =>
          tx
            .select({
              id: deployments.id,
              status: deployments.status,
              manifest: deployments.manifest,
            })
            .from(deployments);
        const [deployment] = input.deployment
          ? await select().where(
              and(
                eq(deployments.id, input.deployment),
                eq(deployments.agentId, suite.agentId),
              ),
            )
          : await select()
              .where(
                and(
                  eq(deployments.agentId, suite.agentId),
                  isNotNull(deployments.promotedAt),
                ),
              )
              .orderBy(desc(deployments.promotedAt))
              .limit(1);
        if (!deployment)
          throw new ApiError(
            404,
            "not_found",
            input.deployment
              ? "No such deployment of this agent."
              : "The agent has no production deployment; name one.",
          );
        if (deployment.status !== "ready")
          throw new ApiError(409, "conflict", "The deployment is not ready.");
        const models = input.models ?? [
          (
            await effectiveSettings(
              tx,
              suite.agentId,
              deployment.manifest as Manifest,
            )
          ).model,
        ];
        const created = await createRuns(tx, {
          organizationId: org,
          suiteId: id,
          deploymentId: deployment.id,
          models: [...new Set(models)],
          trigger: "manual",
          createdBy: actor(c.var.caller).actorId,
        });
        await audit(tx, {
          ...eventBase(c.var),
          action: "eval_run.started",
          targetType: "eval_suite",
          targetId: id,
          data: { deployment: deployment.id, models, runs: created.runs },
        });
        const rows = await tx
          .select()
          .from(evalRuns)
          .where(inArray(evalRuns.id, created.runs));
        return { runs: rows.map(runView), outboxRows: created.outboxRows };
      });
      await drainRuns(c.env, org, outboxRows);
      return c.json({ runs }, 202);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/eval-runs/{run}",
      tags: ["Evals"],
      summary:
        "An eval run with each case's result and each field's match rate",
      request: { params: RunParam },
      responses: { 200: json(RunDetail, "The run") },
    }),
    async (c) => {
      const { run: id } = c.req.valid("param");
      const view = await withOrg(c.env, c.var.org, async (tx) => {
        await requireDeveloper(tx, c.var.caller);
        const [run] = await tx
          .select()
          .from(evalRuns)
          .where(eq(evalRuns.id, id));
        if (!run) throw new ApiError(404, "not_found", "No such eval run.");
        const results = await tx
          .select()
          .from(evalResults)
          .where(eq(evalResults.runId, id))
          .orderBy(asc(evalResults.caseId));
        const byPath = new Map<string, { n: number; matched: number }>();
        for (const result of results)
          for (const f of result.fields ?? []) {
            const t = byPath.get(f.path) ?? { n: 0, matched: 0 };
            t.n++;
            if (f.match) t.matched++;
            byPath.set(f.path, t);
          }
        return {
          ...runView(run),
          fields: [...byPath]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([path, t]) => ({ path, matchRate: t.matched / t.n })),
          results: results.map((r) => ({
            caseId: r.caseId,
            status: r.status,
            fields: r.fields,
            answers: r.answers,
            reason: r.reason,
            costUsd: usd(r.costMicroUsd),
          })),
        };
      });
      return c.json(view, 200);
    },
  );
