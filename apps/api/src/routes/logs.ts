// Run logs (design doc 09, spec 12). Anyone who can see a case reads its
// logs; the logs across an agent's cases and deployments, and across the
// organization, are for Developers and for Owners and Admins.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { withOrg } from "@preprocess/db/client";
import { cases } from "@preprocess/db/schema/cases";
import { logSummaries } from "@preprocess/db/schema/logs";
import { LEVELS } from "@preprocess/logs";
import { and, eq } from "drizzle-orm";

import { agentRole, canSeeCase } from "../access.ts";
import type { OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import type { Env } from "../env.ts";
import { logStore } from "../logs.ts";

const OrgParam = z.object({ org: z.string() });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const Filters = z.object({
  level: z.enum(LEVELS).optional(),
  search: z.string().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().max(26).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const Log = z
  .object({
    id: z.string(),
    at: z.string(),
    agentId: z.string().nullable(),
    deploymentId: z.string().nullable(),
    caseId: z.string().nullable(),
    source: z.enum(["platform", "agent"]),
    level: z.enum(LEVELS),
    kind: z.string(),
    message: z.string(),
    durationMs: z.number().nullable(),
    traceId: z.string().nullable(),
    spanId: z.string().nullable(),
    error: z
      .object({
        message: z.string(),
        why: z.string().optional(),
        fix: z.string().optional(),
        status: z.number().optional(),
      })
      .nullable(),
    data: z.record(z.string(), z.unknown()),
  })
  .openapi("Log");

const Summary = z
  .object({
    events: z.number(),
    errors: z.number(),
    warnings: z.number(),
    lastError: z
      .object({ at: z.string(), kind: z.string(), message: z.string() })
      .nullable(),
    firstAt: z.string(),
    lastAt: z.string(),
  })
  .openapi("LogSummary");

const LogPage = z
  .object({
    logs: z.array(Log),
    cursor: z.string().nullable(),
    summary: Summary.nullable().openapi({
      description: "Totals for the case or deployment filtered on, if any",
    }),
  })
  .openapi("LogPage");

const page = async (
  env: Env,
  vars: OrgVariables,
  q: z.infer<typeof Filters> & {
    agentId?: string | undefined;
    deploymentId?: string | undefined;
    caseId?: string | undefined;
  },
) => {
  const subject = q.caseId
    ? ({ kind: "case", id: q.caseId } as const)
    : q.deploymentId
      ? ({ kind: "deployment", id: q.deploymentId } as const)
      : null;
  const [result, summary] = await Promise.all([
    logStore(env).query({ ...q, organizationId: vars.org }),
    subject
      ? withOrg(env, vars.org, async (tx) => {
          const [row] = await tx
            .select()
            .from(logSummaries)
            .where(
              and(
                eq(logSummaries.subjectKind, subject.kind),
                eq(logSummaries.subjectId, subject.id),
              ),
            );
          return row ?? null;
        })
      : null,
  ]);
  return {
    logs: result.records.map(({ organizationId: _org, data, ...r }) => ({
      ...r,
      data: JSON.parse(data) as Record<string, unknown>,
    })),
    cursor: result.cursor,
    summary: summary && {
      events: summary.events,
      errors: summary.errors,
      warnings: summary.warnings,
      lastError: summary.lastError,
      firstAt: summary.firstAt.toISOString(),
      lastAt: summary.lastAt.toISOString(),
    },
  };
};

export const logRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/logs",
      tags: ["Logs"],
      summary: "Search run logs",
      description:
        "Across the organization for Owners, Admins and Developers; filtered on an agent, also for Developers. Seven days by default, at most 31.",
      request: {
        params: OrgParam,
        query: Filters.extend({
          agent: z.string().optional(),
          deployment: z.string().optional(),
          case: z.string().optional(),
        }),
      },
      responses: { 200: json(LogPage, "Newest first") },
    }),
    async (c) => {
      const q = c.req.valid("query");
      const caller = c.var.caller;
      // An unknown agent id gives a person Developers' role only.
      const role = await withOrg(c.env, c.var.org, (tx) =>
        agentRole(tx, caller, q.agent ?? ""),
      );
      if (
        caller.role !== "owner" &&
        caller.role !== "admin" &&
        role !== "manage"
      )
        throw new ApiError(
          403,
          "forbidden",
          "Logs across cases are for Developers, Owners and Admins.",
        );
      return c.json(
        await page(c.env, c.var, {
          ...q,
          agentId: q.agent,
          deploymentId: q.deployment,
          caseId: q.case,
        }),
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/cases/{id}/logs",
      tags: ["Logs"],
      summary: "A case's run logs",
      request: {
        params: OrgParam.extend({ id: z.string() }),
        query: Filters,
      },
      responses: {
        200: json(LogPage, "Newest first"),
        404: json(z.object({}), "No such case"),
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const found = await withOrg(c.env, c.var.org, async (tx) => {
        const [row] = await tx
          .select({ agentId: cases.agentId, createdAt: cases.createdAt })
          .from(cases)
          .where(eq(cases.id, id));
        if (!row) return null;
        return { ...row, role: await agentRole(tx, c.var.caller, row.agentId) };
      });
      if (!found || !canSeeCase(c.var.caller, found.role))
        throw new ApiError(404, "not_found", "No such case.");
      const q = c.req.valid("query");
      return c.json(
        await page(c.env, c.var, {
          ...q,
          from: q.from ?? found.createdAt.toISOString(),
          agentId: found.agentId,
          caseId: id,
        }),
        200,
      );
    },
  );
