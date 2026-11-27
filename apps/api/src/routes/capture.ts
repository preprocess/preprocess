// Run capture read and export (design doc 10): a case's run capture as
// stored, its review events, and an agent's closed cases as NDJSON pages.
// Capture, datasets and export work whether or not training is on.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";

import { eventBase, requireDeveloper } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import {
  CLOSED,
  caseReviewEvents,
  EXPORT_LIMIT_MAX,
  exportable,
  exportPage,
  readCaseCapture,
  streamExport,
} from "../capture.ts";
import { ApiError, findAgent } from "../cases.ts";
import type { Env } from "../env.ts";

const OrgParam = z.object({ org: z.string() });
const CaseParam = OrgParam.extend({ id: z.string() });
const AgentParam = OrgParam.extend({ agent: z.string() });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const ErrorBody = z
  .object({ error: z.object({ code: z.string(), message: z.string() }) })
  .openapi("Error");
const error = (description: string) => json(ErrorBody, description);

const RunCapture = z
  .object({
    format: z.literal("preprocess.run"),
    version: z.literal(1),
    organizationId: z.string(),
    agentId: z.string(),
    deploymentId: z.string(),
    caseId: z.string(),
    sdkVersion: z.string(),
    model: z.string(),
    status: z.enum(["completed", "failed"]),
    usage: z.record(z.string(), z.unknown()),
    events: z.array(
      z.object({
        seq: z.number(),
        at: z.string(),
        kind: z.string(),
        data: z.record(z.string(), z.unknown()),
      }),
    ),
  })
  .openapi("RunCapture", {
    description:
      "A case's full run (format preprocess.run, version 1): model calls, tool calls and results, tokens, cost and timing",
  });

const ReviewEvent = z
  .object({
    kind: z.string(),
    path: z.string().nullable(),
    before: z.unknown(),
    after: z.unknown(),
    checks: z.unknown(),
    userId: z.string(),
    at: z.string(),
  })
  .openapi("ReviewEvent");

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").filter(Boolean) : []));

export const ExportQuery = z.object({
  from: z.string().datetime().optional().openapi({
    description: "Cases created at or after this time",
  }),
  to: z.string().datetime().optional().openapi({
    description: "Cases created before this time",
  }),
  status: csv.pipe(z.array(z.enum(CLOSED))).openapi({
    description: "Closed statuses, comma-separated; default all of them",
  }),
  cursor: z.string().optional().openapi({
    description: "The next cursor from the previous page's trailer",
  }),
  limit: z.coerce.number().int().min(1).max(EXPORT_LIMIT_MAX).default(100),
});

export const ndjson = (description: string) => ({
  content: { "application/x-ndjson": { schema: z.string() } },
  description,
});

export const captureRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/cases/{id}/capture",
      tags: ["Training"],
      summary: "A case's run capture as stored",
      request: { params: CaseParam },
      responses: {
        200: json(RunCapture, "The run capture"),
        404: error("No such case, or it has no run capture"),
        409: error("The case is still running (capture_not_ready)"),
        410: error("Retention deleted the capture (capture_purged)"),
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      return c.json(await readCaseCapture(c.env, c.var, id), 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/cases/{id}/review-events",
      tags: ["Training"],
      summary: "A case's review events, oldest first",
      description:
        "Every change a person made to the case's answers or flow: edits, confirmations, accepted suggestions, reruns, files, completion and cancellation.",
      request: { params: CaseParam },
      responses: {
        200: json(z.object({ items: z.array(ReviewEvent) }), "The events"),
        404: error("No such case"),
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      return c.json({ items: await caseReviewEvents(c.env, c.var, id) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/agents/{agent}/capture/export",
      tags: ["Training"],
      summary:
        "Export an agent's closed cases with their run capture as NDJSON (Developers, Admins, API keys)",
      description:
        'One line per closed case, oldest first: { case, capture, reviewEvents }. The last line is { "next": cursor or null, "purged": n }, where purged counts cases skipped because retention deleted their capture. Each export is recorded as capture.exported.',
      request: { params: AgentParam, query: ExportQuery },
      responses: {
        200: ndjson("The cases, streamed as an attachment"),
        400: { description: "A bad cursor or filter" },
        403: { description: "Not a Developer, Admin or Owner" },
        404: { description: "No such agent" },
      },
    }),
    async (c) => {
      const { agent: ref } = c.req.valid("param");
      const query = c.req.valid("query");
      const { agentId, page } = await withOrg(c.env, c.var.org, async (tx) => {
        await requireDeveloper(tx, c.var.caller);
        const agent = await findAgent(tx, ref);
        if (!agent) throw new ApiError(404, "not_found", "No such agent.");
        const page = await exportable(
          tx,
          await exportPage(tx, agent.id, query, query),
        );
        await audit(tx, {
          ...eventBase(c.var),
          action: "capture.exported",
          targetType: "agent",
          targetId: agent.id,
          data: {
            agent: agent.id,
            filters: {
              from: query.from ?? null,
              to: query.to ?? null,
              status: query.status,
              cursor: query.cursor ?? null,
              limit: query.limit,
            },
            count: page.kept.length,
            purged: page.purged,
          },
        });
        return { agentId: agent.id, page };
      });
      return streamExport(
        c.env,
        c.var.org,
        page,
        (item) => item,
        `capture-${agentId}.ndjson`,
      );
    },
  );
