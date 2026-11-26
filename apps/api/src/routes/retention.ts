// Retention (spec 16a): the organization's periods, and an Owner deleting one
// closed case by hand. The settings screen waits for its design (PLAT-44).

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { cases } from "@preprocess/db/schema/cases";
import { MIN_RETENTION_DAYS } from "@preprocess/db/schema/retention";
import { eq } from "drizzle-orm";

import { eventBase } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import type { Env } from "../env.ts";
import {
  caseRef,
  CLOSED,
  deleteCases,
  readRetention,
  requireOwner,
  setRetention,
} from "../retention.ts";

const OrgParam = z.object({ org: z.string() });
const CaseParam = OrgParam.extend({ id: z.string() });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const ErrorBody = z
  .object({ error: z.object({ code: z.string(), message: z.string() }) })
  .openapi("Error");
const error = (description: string) => json(ErrorBody, description);

const Days = z
  .number()
  .int("A retention period is a whole number of days.")
  .min(
    MIN_RETENTION_DAYS,
    `A retention period is at least ${MIN_RETENTION_DAYS} days.`,
  )
  .max(36_500, "A retention period is at most 36,500 days.")
  .nullable();

const describeDays = (what: string) =>
  `Days ${what} is kept after its case closes; null keeps it forever (the default)`;

const Retention = z
  .object({
    documentsDays: Days.openapi({
      description: describeDays("a case's files"),
    }),
    runCaptureDays: Days.openapi({
      description: describeDays("a case's run capture"),
    }),
    runLogsDays: Days.openapi({
      description: describeDays("a case's run logs"),
    }),
    casesDays: Days.openapi({
      description: describeDays("the whole case"),
    }),
    updatedAt: z.string().nullable(),
  })
  .openapi("Retention");

const RetentionChange = z
  .object({
    documentsDays: Days.optional(),
    runCaptureDays: Days.optional(),
    runLogsDays: Days.optional(),
    casesDays: Days.optional(),
  })
  .strict()
  .openapi("RetentionChange", {
    description: "The periods to change; an absent key keeps its period",
  });

const read = async (tx: Tx, vars: OrgVariables) => {
  const { periods, updatedAt } = await readRetention(tx, vars.org);
  return {
    documentsDays: periods.documents,
    runCaptureDays: periods.runCapture,
    runLogsDays: periods.runLogs,
    casesDays: periods.cases,
    updatedAt: updatedAt?.toISOString() ?? null,
  };
};

export const retentionRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>({
  defaultHook: (result, c) => {
    if (!result.success)
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: result.error.issues
              .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
              .join("; "),
          },
        },
        400,
      );
  },
})
  .openapi(
    createRoute({
      method: "get",
      path: "/retention",
      tags: ["Settings"],
      summary:
        "How long the organization keeps documents, run capture, run logs and cases",
      request: { params: OrgParam },
      responses: { 200: json(Retention, "The retention periods") },
    }),
    async (c) =>
      c.json(await withOrg(c.env, c.var.org, (tx) => read(tx, c.var)), 200),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/retention",
      tags: ["Settings"],
      summary: "Change retention periods",
      description:
        "Owners and Admins. Only Owners can shorten a period or end keep-forever; Admins can lengthen one. Each change is audited as retention.updated with its before and after values.",
      request: {
        params: OrgParam,
        body: {
          content: { "application/json": { schema: RetentionChange } },
          required: true,
        },
      },
      responses: {
        200: json(Retention, "The retention periods"),
        400: error("A period is not a whole number of days from 7 to 36,500"),
        403: error("Only Owners shorten a period; members change none"),
      },
    }),
    async (c) => {
      if (c.var.caller.role === "member")
        throw new ApiError(
          403,
          "forbidden",
          "Only Owners and Admins can change retention.",
        );
      const body = c.req.valid("json");
      const result = await withOrg(c.env, c.var.org, async (tx) => {
        await setRetention(tx, c.var, {
          ...(body.documentsDays !== undefined && {
            documents: body.documentsDays,
          }),
          ...(body.runCaptureDays !== undefined && {
            runCapture: body.runCaptureDays,
          }),
          ...(body.runLogsDays !== undefined && { runLogs: body.runLogsDays }),
          ...(body.casesDays !== undefined && { cases: body.casesDays }),
        });
        return read(tx, c.var);
      });
      return c.json(result, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/cases/{id}",
      tags: ["Cases"],
      summary: "Delete a closed case (Owner)",
      description:
        "Deletes the case, its files, run capture, review events, approvals and mentions, and removes it from eval suites. Audit events stay; exports already taken and trained checkpoints are not changed. Audited as case.deleted.",
      request: { params: CaseParam },
      responses: {
        204: { description: "Deleted" },
        403: error("Only Owners delete a case"),
        404: error("No such case"),
        409: error("The case is still open"),
      },
    }),
    async (c) => {
      requireOwner(c.var.caller);
      const { id } = c.req.valid("param");
      await withOrg(c.env, c.var.org, async (tx) => {
        const [found] = await tx
          .select({
            ...caseRef,
            deploymentId: cases.deploymentId,
            status: cases.status,
          })
          .from(cases)
          .where(eq(cases.id, id))
          .for("update");
        if (!found) throw new ApiError(404, "not_found", "No such case.");
        if (!(CLOSED as readonly string[]).includes(found.status))
          throw new ApiError(
            409,
            "case_open",
            "Only a completed, failed or cancelled case can be deleted. Cancel it first.",
          );
        await deleteCases(c.env, tx, c.var.org, [found]);
        await audit(tx, {
          ...eventBase(c.var),
          action: "case.deleted",
          targetType: "case",
          targetId: id,
          caseId: id,
          data: { agentId: found.agentId, deploymentId: found.deploymentId },
        });
      });
      return c.body(null, 204);
    },
  );
