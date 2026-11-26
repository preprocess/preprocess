// Cases (design doc 04) and the case room (doc 05): files, the 202 create,
// the status URL, and what a person does on a case. Every change a person
// makes to answers or the flow is a review event.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents, groups } from "@preprocess/db/schema/access";
import {
  caseAssignees,
  cases,
  files,
  reviewEvents,
} from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { member, user } from "@preprocess/db/schema/auth";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  or,
} from "drizzle-orm";
import type { Context } from "hono";

import {
  agentRole,
  canSeeCase,
  canWorkCase,
  mayApprove,
  visibleAgents,
} from "../access.ts";
import { eventBase, requireAdmin } from "../caller.ts";
import type { OrgRole, OrgVariables } from "../caller.ts";
import { ApiError, createCase, type Approval } from "../cases.ts";
import type { Env, WriteResult } from "../env.ts";
import { acceptedMemories } from "../memories.ts";
import { notifyLater } from "../notify.ts";
import { ocrFile } from "../ocr.ts";
import { drainOutbox } from "../outbox.ts";
import { refuseOverLimit } from "../spend.ts";

type Ctx = Context<{ Bindings: Env; Variables: OrgVariables }>;

const OrgParam = z.object({ org: z.string() });
const CaseParam = OrgParam.extend({ id: z.string() });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});

const ErrorBody = z
  .object({ error: z.object({ code: z.string(), message: z.string() }) })
  .openapi("Error");
const error = (description: string) => json(ErrorBody, description);

const MAX_FILE_BYTES = 100 * 1024 * 1024;

const File = z
  .object({
    id: z.string(),
    name: z.string(),
    contentType: z.string(),
    size: z.number(),
    createdAt: z.string(),
  })
  .openapi("File");

const CreateCase = z
  .object({
    agent: z.string().openapi({ description: "Agent slug or id" }),
    deployment: z.string().optional().openapi({
      description: "A deployment id; default: the production deployment",
    }),
    text: z.string().max(1_000_000).optional(),
    files: z.array(z.string()).max(100).default([]),
  })
  .refine((b) => (b.text?.length ?? 0) > 0 || b.files.length > 0, {
    message: "text, files, or both are required",
  })
  .openapi("CreateCase");

const CaseAccepted = z
  .object({
    id: z.string(),
    status: z.literal("queued"),
    statusUrl: z.string().url(),
    createdAt: z.string().datetime(),
  })
  .openapi("CaseAccepted");

const Case = z
  .object({
    id: z.string(),
    agent: z.object({ id: z.string(), slug: z.string() }),
    deployment: z.object({
      id: z.string(),
      environment: z.enum(["production", "preview"]),
    }),
    status: z.enum([
      "queued",
      "running",
      "waiting",
      "halted",
      "completed",
      "failed",
      "cancelled",
    ]),
    haltReason: z
      .enum(["credit_exhausted", "spending_limit_reached"])
      .nullable(),
    waitingOn: z
      .object({ id: z.string(), slug: z.string(), name: z.string() })
      .nullable(),
    assignees: z.array(z.object({ id: z.string() })),
    source: z.enum(["api", "app", "mcp", "schedule"]),
    title: z.string().nullable(),
    answers: z.record(z.string(), z.unknown()).nullable(),
    error: z.object({ code: z.string(), message: z.string() }).nullable(),
    costUsd: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().nullable(),
    url: z.string().url(),
  })
  .openapi("Case");

const CaseStatus = Case.shape.status;

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").filter(Boolean) : []));

const ListQuery = z.object({
  agent: csv.openapi({ description: "Agent slugs, comma-separated" }),
  status: csv
    .pipe(z.array(CaseStatus))
    .openapi({ description: "Statuses, comma-separated" }),
  waitingOn: csv.openapi({
    description: "Group slugs the case waits on, comma-separated",
  }),
  assignee: csv.openapi({
    description:
      "User ids assigned to the case, comma-separated; `me` is the signed-in person",
  }),
  environment: z.enum(["production", "preview"]).default("production"),
  q: z.string().optional().openapi({ description: "Matches the title or id" }),
  sort: z.enum(["updatedAt", "createdAt"]).default("updatedAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

const CaseSummary = Case.omit({ answers: true, error: true, url: true })
  .extend({
    deployment: Case.shape.deployment.extend({ branch: z.string().nullable() }),
    assignees: z.array(z.object({ id: z.string(), name: z.string() })),
  })
  .openapi("CaseSummary");

const CaseList = z
  .object({
    items: z.array(CaseSummary),
    nextCursor: z.string().nullable(),
    counts: z.record(CaseStatus, z.number()).openapi({
      description: "Cases per status under every filter but status",
    }),
  })
  .openapi("CaseList");

const RoomState = z
  .record(z.string(), z.unknown())
  .openapi("CaseRoom", { description: "Fields, answers, checks and thread" });

const Change = z
  .object({
    result: z.record(z.string(), z.unknown()),
    checks: z.array(z.record(z.string(), z.unknown())),
  })
  .openapi("AnswerChange");

const Edit = z.object({
  path: z.string().min(1),
  version: z.number().int().min(0),
});

// The case, if the caller may see it, and whether they may work it.
const loadCase = async (c: Ctx, id: string, work: boolean) => {
  const found = await withOrg(c.env, c.var.org, async (tx) => {
    const [row] = await tx
      .select({ agentId: cases.agentId, status: cases.status })
      .from(cases)
      .where(eq(cases.id, id));
    if (!row) return null;
    return { ...row, role: await agentRole(tx, c.var.caller, row.agentId) };
  });
  if (!found || !canSeeCase(c.var.caller, found.role))
    throw new ApiError(404, "not_found", "No such case.");
  if (work && !canWorkCase(found.role))
    throw new ApiError(
      403,
      "forbidden",
      "Working a case needs operator access to the agent.",
    );
  return {
    status: found.status,
    key: { organizationId: c.var.org, agentId: found.agentId, caseId: id },
  };
};

const runtime = (c: Ctx) => {
  if (!c.env.RUNTIME)
    throw new ApiError(503, "unavailable", "The case runtime is not running.");
  return c.env.RUNTIME;
};

const personId = (c: Ctx) =>
  c.var.caller.type === "person" ? c.var.caller.userId : c.var.caller.keyId;

const recordReview = (
  tx: Tx,
  c: Ctx,
  caseId: string,
  e: {
    kind: string;
    path?: string | null;
    before?: unknown;
    after?: unknown;
    checks?: unknown;
  },
) =>
  tx.insert(reviewEvents).values({
    id: newId("reviewEvent"),
    organizationId: c.var.org,
    caseId,
    userId: personId(c),
    kind: e.kind,
    path: e.path ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    checks: e.checks ?? null,
  });

// Answers the runtime refused or found changed since the person loaded them.
const answerChange = async (
  c: Ctx,
  caseId: string,
  kind: string,
  change: { result: WriteResult; checks: unknown[] },
) => {
  const result = change.result;
  if (result.result === "conflict")
    throw new ApiError(
      409,
      "version_conflict",
      `${result.path} changed since you loaded it (now version ${result.version}). Reload and try again.`,
    );
  if (result.result === "refused")
    throw new ApiError(422, "refused", `${result.path}: ${result.reason}`);
  await withOrg(c.env, c.var.org, (tx) =>
    recordReview(tx, c, caseId, {
      kind,
      path: result.path,
      before: result.before,
      after: result.after,
      checks: change.checks,
    }),
  );
  const response: z.infer<typeof Change> = {
    result: { ...result },
    checks: change.checks as z.infer<typeof Change>["checks"],
  };
  return c.json(response, 200);
};

const ApprovalParam = CaseParam.extend({ approval: z.string() });

// A person decides an approval (spec §9). The runtime holds the request; the
// decision is a review event and an audit event.
const decideApproval = async (
  c: Ctx,
  caseId: string,
  approvalId: string,
  approve: boolean,
  note: string | undefined,
) => {
  const { key, status } = await loadCase(c, caseId, true);
  const state = (await runtime(c).caseState(key)) as unknown as {
    approvals?: Approval[];
  };
  const found = state.approvals?.find((a) => a.id === approvalId);
  if (!found) throw new ApiError(404, "not_found", "No such approval.");
  if (found.status !== "pending")
    throw new ApiError(
      409,
      "approval_decided",
      `The approval is ${found.status}.`,
    );
  if (status === "running")
    throw new ApiError(409, "case_running", "Decide once the run ends.");
  const allowed = await withOrg(c.env, c.var.org, (tx) =>
    mayApprove(tx, c.var.caller, key.agentId, found.group),
  );
  if (!allowed)
    throw new ApiError(
      403,
      "forbidden",
      found.group
        ? `Only members of ${found.group} approve this.`
        : "Approving needs a person with operator access to the agent.",
    );
  const next = await runtime(c).decideApproval({
    ...key,
    id: approvalId,
    approve,
    userId: personId(c),
    note: note ?? null,
  });
  const decision = approve ? "approved" : "rejected";
  await withOrg(c.env, c.var.org, async (tx) => {
    await recordReview(tx, c, caseId, {
      kind: `approval.${decision}`,
      path: found.level === "completion" ? null : found.target,
      before: found.payload,
      after: { level: found.level, note: note ?? null },
    });
    await audit(tx, {
      ...eventBase(c.var),
      action: `case.approval.${decision}`,
      targetType: "case",
      targetId: caseId,
      caseId,
      data: {
        approval: approvalId,
        level: found.level,
        target: found.target,
        group: found.group,
        note: note ?? null,
      },
    });
  });
  return c.json(next as unknown as z.infer<typeof RoomState>, 200);
};

export const caseRoutes = new OpenAPIHono<{
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
      method: "post",
      path: "/files",
      tags: ["Cases"],
      summary: "Upload a file to start a case with",
      request: {
        params: OrgParam,
        body: {
          content: {
            "multipart/form-data": {
              schema: z.object({
                file: z.any().openapi({ type: "string", format: "binary" }),
              }),
            },
          },
          required: true,
        },
      },
      responses: { 201: json(File, "Stored"), 400: error("No file") },
    }),
    async (c) => {
      const form = await c.req.formData();
      const upload = form.get("file");
      if (!upload || typeof upload === "string")
        throw new ApiError(400, "invalid_request", 'Send the file as "file".');
      if (upload.size > MAX_FILE_BYTES)
        throw new ApiError(413, "too_large", "Files are at most 100 MB.");
      const bytes = new Uint8Array(await upload.arrayBuffer());
      const sha256 = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );
      const id = newId("file");
      const r2Key = `${c.var.org}/files/${id}`;
      const contentType = upload.type || "application/octet-stream";
      await c.env.FILES.put(r2Key, bytes, {
        httpMetadata: { contentType },
      });
      const [row] = await withOrg(c.env, c.var.org, (tx) =>
        tx
          .insert(files)
          .values({
            id,
            organizationId: c.var.org,
            name: upload.name || "file",
            contentType,
            size: bytes.length,
            sha256,
            r2Key,
            createdBy: personId(c),
          })
          .returning(),
      );
      return c.json(
        {
          id,
          name: row!.name,
          contentType,
          size: bytes.length,
          createdAt: row!.createdAt.toISOString(),
        },
        201,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cases",
      tags: ["Cases"],
      summary: "Start a case",
      request: {
        params: OrgParam,
        headers: z.object({
          "idempotency-key": z.string().min(1).max(255).optional(),
          "x-preprocess-client": z.string().optional(),
        }),
        ...body(CreateCase),
      },
      responses: {
        202: json(CaseAccepted, "Accepted; poll the status URL"),
        400: error("Body fails validation"),
        402: error("The organization has reached its spending limit"),
        404: error("Agent, deployment or file not visible"),
        409: error("No production deployment, or the same key in progress"),
        422: error("Same Idempotency-Key, different request"),
      },
    }),
    async (c) => {
      const headers = c.req.valid("header");
      const caller = c.var.caller;
      const source =
        headers["x-preprocess-client"] === "mcp"
          ? "mcp"
          : caller.type === "person"
            ? "app"
            : "api";
      const { body: accepted, replayed } = await createCase(
        c.env,
        c.var.org,
        c.req.valid("json"),
        {
          source,
          createdBy: personId(c),
          actorType: caller.type === "person" ? "person" : "api_key",
          caller,
          requestId: c.var.request.requestId,
          ip: c.var.request.ip,
        },
        headers["idempotency-key"],
      );
      c.header("Location", accepted.statusUrl);
      if (replayed) c.header("Idempotent-Replayed", "true");
      return c.json(accepted, 202);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/cases",
      tags: ["Cases"],
      summary: "Cases across the agents the caller can see",
      request: { params: OrgParam, query: ListQuery },
      responses: {
        200: json(CaseList, "A page of cases"),
        400: error("Bad cursor or filter"),
      },
    }),
    async (c) => {
      const query = c.req.valid("query");
      let after: [string, string] | null = null;
      if (query.cursor) {
        try {
          after = JSON.parse(atob(query.cursor)) as [string, string];
        } catch {
          throw new ApiError(400, "invalid_request", "Bad cursor.");
        }
      }
      const { caller } = c.var;
      if (query.assignee.includes("me") && caller.type !== "person")
        throw new ApiError(
          400,
          "invalid_request",
          "assignee=me needs a signed-in person.",
        );
      const assignedTo = query.assignee.map((id) =>
        id === "me" && caller.type === "person" ? caller.userId : id,
      );
      const page = await withOrg(c.env, c.var.org, async (tx) => {
        const visible = await visibleAgents(tx, c.var.caller);
        if (visible?.length === 0) return { rows: [], counts: [] };
        const column =
          query.sort === "updatedAt" ? cases.updatedAt : cases.createdAt;
        const filters = and(
          visible ? inArray(cases.agentId, visible) : undefined,
          eq(deployments.environment, query.environment),
          query.agent.length ? inArray(agents.slug, query.agent) : undefined,
          query.waitingOn.length
            ? inArray(groups.slug, query.waitingOn)
            : undefined,
          assignedTo.length
            ? inArray(
                cases.id,
                tx
                  .select({ id: caseAssignees.caseId })
                  .from(caseAssignees)
                  .where(inArray(caseAssignees.userId, assignedTo)),
              )
            : undefined,
          query.q
            ? or(ilike(cases.title, `%${query.q}%`), eq(cases.id, query.q))
            : undefined,
        );
        const base = () =>
          tx
            .select({
              case: cases,
              agentSlug: agents.slug,
              environment: deployments.environment,
              branch: deployments.gitBranch,
              waitingOn: {
                id: groups.id,
                slug: groups.slug,
                name: groups.name,
              },
            })
            .from(cases)
            .innerJoin(agents, eq(agents.id, cases.agentId))
            .innerJoin(deployments, eq(deployments.id, cases.deploymentId))
            .leftJoin(groups, eq(groups.id, cases.waitingOnGroupId));
        const asc_ = query.dir === "asc";
        const [rows, counts] = await Promise.all([
          base()
            .where(
              and(
                filters,
                query.status.length
                  ? inArray(cases.status, query.status)
                  : undefined,
                after
                  ? or(
                      (asc_ ? gt : lt)(column, new Date(after[0])),
                      and(
                        eq(column, new Date(after[0])),
                        (asc_ ? gt : lt)(cases.id, after[1]),
                      ),
                    )
                  : undefined,
              ),
            )
            .orderBy(
              asc_ ? asc(column) : desc(column),
              asc_ ? asc(cases.id) : desc(cases.id),
            )
            .limit(query.limit + 1),
          tx
            .select({ status: cases.status, n: count() })
            .from(cases)
            .innerJoin(agents, eq(agents.id, cases.agentId))
            .innerJoin(deployments, eq(deployments.id, cases.deploymentId))
            .leftJoin(groups, eq(groups.id, cases.waitingOnGroupId))
            .where(filters)
            .groupBy(cases.status),
        ]);
        const ids = rows.map((r) => r.case.id);
        const assignees = ids.length
          ? await tx
              .select({
                caseId: caseAssignees.caseId,
                id: user.id,
                name: user.name,
              })
              .from(caseAssignees)
              .innerJoin(user, eq(user.id, caseAssignees.userId))
              .where(inArray(caseAssignees.caseId, ids))
          : [];
        return {
          rows: rows.map((r) => ({
            ...r,
            assignees: assignees
              .filter((a) => a.caseId === r.case.id)
              .map(({ id, name }) => ({ id, name })),
          })),
          counts,
        };
      });
      const more = page.rows.length > query.limit;
      const rows = page.rows.slice(0, query.limit);
      const last = rows.at(-1)?.case;
      return c.json(
        {
          items: rows.map(({ case: k, ...r }) => ({
            id: k.id,
            agent: { id: k.agentId, slug: r.agentSlug },
            deployment: {
              id: k.deploymentId,
              environment: r.environment,
              branch: r.environment === "preview" ? r.branch : null,
            },
            status: k.status,
            haltReason: k.haltReason,
            waitingOn: r.waitingOn?.id ? r.waitingOn : null,
            assignees: r.assignees,
            source: k.source,
            title: k.title,
            costUsd: k.costMicroUsd / 1_000_000,
            createdAt: k.createdAt.toISOString(),
            updatedAt: k.updatedAt.toISOString(),
            completedAt: k.completedAt?.toISOString() ?? null,
          })),
          nextCursor:
            more && last
              ? btoa(JSON.stringify([last[query.sort].toISOString(), last.id]))
              : null,
          counts: Object.fromEntries(
            CaseStatus.options.map((status) => [
              status,
              page.counts.find((r) => r.status === status)?.n ?? 0,
            ]),
          ) as Record<z.infer<typeof CaseStatus>, number>,
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/cases/{id}",
      tags: ["Cases"],
      summary: "A case's status",
      request: { params: CaseParam },
      responses: { 200: json(Case, "The case"), 404: error("Not visible") },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { key } = await loadCase(c, id, false);
      const row = await withOrg(c.env, c.var.org, async (tx) => {
        const [found] = await tx
          .select({
            case: cases,
            agentSlug: agents.slug,
            environment: deployments.environment,
            waitingOn: { id: groups.id, slug: groups.slug, name: groups.name },
          })
          .from(cases)
          .innerJoin(agents, eq(agents.id, cases.agentId))
          .innerJoin(deployments, eq(deployments.id, cases.deploymentId))
          .leftJoin(groups, eq(groups.id, cases.waitingOnGroupId))
          .where(eq(cases.id, id));
        const assignees = await tx
          .select({ id: caseAssignees.userId })
          .from(caseAssignees)
          .where(eq(caseAssignees.caseId, id));
        return { ...found!, assignees };
      });
      const k = row.case;
      const ended = k.status === "completed" || k.status === "failed";
      const room =
        ended && c.env.RUNTIME ? await c.env.RUNTIME.caseState(key) : null;
      return c.json(
        {
          id,
          agent: { id: k.agentId, slug: row.agentSlug },
          deployment: { id: k.deploymentId, environment: row.environment },
          status: k.status,
          haltReason: k.haltReason,
          waitingOn: row.waitingOn?.id ? row.waitingOn : null,
          assignees: row.assignees,
          source: k.source,
          title: k.title,
          answers: k.status === "completed" ? (room?.answers ?? null) : null,
          error:
            k.status === "failed"
              ? {
                  code: "failed",
                  message:
                    (room?.reason as string | undefined) ?? "The case failed.",
                }
              : null,
          costUsd: k.costMicroUsd / 1_000_000,
          createdAt: k.createdAt.toISOString(),
          updatedAt: k.updatedAt.toISOString(),
          completedAt: k.completedAt?.toISOString() ?? null,
          url: new URL(`/cases/${k.agentId}/${id}`, c.env.APP_URL).href,
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/cases/{id}/room",
      tags: ["Case room"],
      summary: "Fields, answers, checks and the thread",
      request: { params: CaseParam },
      responses: {
        200: json(RoomState, "The case room"),
        404: error("Not visible"),
      },
    }),
    async (c) => {
      const { key, status } = await loadCase(c, c.req.valid("param").id, false);
      if (status === "queued")
        return c.json(
          { status, fields: [], answers: null, checks: [], thread: [] },
          200,
        );
      return c.json(await runtime(c).caseState(key), 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/cases/{id}/answers",
      tags: ["Case room"],
      summary: "Change an answer",
      request: {
        params: CaseParam,
        ...body(Edit.extend({ value: z.unknown() })),
      },
      responses: {
        200: json(Change, "Changed"),
        409: error("The answer changed since that version"),
        422: error("Refused: hidden, or not an option"),
      },
    }),
    async (c) => {
      const { key } = await loadCase(c, c.req.valid("param").id, true);
      const input = c.req.valid("json");
      const change = await runtime(c).editAnswer({
        ...key,
        path: input.path,
        version: input.version,
        value: input.value ?? null,
        userId: personId(c),
      });
      return answerChange(c, key.caseId, "field.edited", change);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cases/{id}/answers/confirm",
      tags: ["Case room"],
      summary: "Confirm an answer as it stands",
      request: { params: CaseParam, ...body(Edit) },
      responses: {
        200: json(Change, "Confirmed"),
        409: error("The answer changed since that version"),
        422: error("Nothing to confirm"),
      },
    }),
    async (c) => {
      const { key } = await loadCase(c, c.req.valid("param").id, true);
      const change = await runtime(c).confirmAnswer({
        ...key,
        ...c.req.valid("json"),
        userId: personId(c),
      });
      return answerChange(c, key.caseId, "field.confirmed", change);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cases/{id}/answers/accept",
      tags: ["Case room"],
      summary: "Accept the agent's suggestion beside an answer",
      request: { params: CaseParam, ...body(Edit) },
      responses: {
        200: json(Change, "Accepted"),
        409: error("The answer changed since that version"),
        422: error("No suggestion"),
      },
    }),
    async (c) => {
      const { key } = await loadCase(c, c.req.valid("param").id, true);
      const change = await runtime(c).acceptSuggestion({
        ...key,
        ...c.req.valid("json"),
        userId: personId(c),
      });
      return answerChange(c, key.caseId, "suggestion.accepted", change);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cases/{id}/options",
      tags: ["Case room"],
      summary: "Search a field's options",
      request: {
        params: CaseParam,
        ...body(
          z.object({
            path: z.string().min(1),
            query: z.string().optional(),
            cursor: z.string().optional(),
            limit: z.number().int().min(1).max(100).optional(),
          }),
        ),
      },
      responses: {
        200: json(z.record(z.string(), z.unknown()), "A page of options"),
      },
    }),
    async (c) => {
      const { key } = await loadCase(c, c.req.valid("param").id, true);
      const page = await runtime(c).searchOptions({
        ...key,
        ...c.req.valid("json"),
      });
      return c.json(page as Record<string, unknown>, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cases/{id}/messages",
      tags: ["Case room"],
      summary: "Post to the case thread; @group mentions reach the inbox",
      request: {
        params: CaseParam,
        ...body(z.object({ text: z.string().trim().min(1).max(20_000) })),
      },
      responses: {
        201: json(
          z.object({ id: z.string(), mentioned: z.array(z.string()) }),
          "Posted",
        ),
      },
    }),
    async (c) => {
      const { key, status } = await loadCase(c, c.req.valid("param").id, true);
      if (status === "queued")
        throw new ApiError(409, "case_queued", "The case has not started yet.");
      const posted = await runtime(c).postMessage({
        ...key,
        userId: personId(c),
        text: c.req.valid("json").text,
      });
      return c.json(posted, 201);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cases/{id}/rerun",
      tags: ["Case room"],
      summary: "Continue the case: rerun the agent with what people changed",
      request: { params: CaseParam },
      responses: {
        200: json(RoomState, "Running"),
        402: error("The organization has reached its spending limit"),
        409: error("The case is running, queued or cancelled"),
      },
    }),
    async (c) => {
      const { key, status } = await loadCase(c, c.req.valid("param").id, true);
      if (status === "queued" || status === "running" || status === "cancelled")
        throw new ApiError(
          409,
          "case_not_rerunnable",
          `The case is ${status}.`,
        );
      // What people changed since the last rerun, for the agent's prompt.
      // A rerun runs the agent again, so it passes the spend gate first; this
      // is how a halted case restarts.
      const { notes, memories } = await withOrg(
        c.env,
        c.var.org,
        async (tx) => {
          await refuseOverLimit(tx);
          const events = await tx
            .select({
              kind: reviewEvents.kind,
              path: reviewEvents.path,
              before: reviewEvents.before,
              after: reviewEvents.after,
              at: reviewEvents.at,
            })
            .from(reviewEvents)
            .where(eq(reviewEvents.caseId, key.caseId))
            .orderBy(asc(reviewEvents.at));
          const since = events.filter((e) => e.kind === "rerun").at(-1)?.at;
          return {
            notes: events
              .filter((e) => e.kind !== "rerun" && (!since || e.at > since))
              .map(({ kind, path, before, after }) => ({
                kind,
                path,
                before,
                after,
              })),
            memories: await acceptedMemories(tx, key.agentId),
          };
        },
      );
      const state = await runtime(c).rerun({ ...key, notes, memories });
      await withOrg(c.env, c.var.org, (tx) =>
        recordReview(tx, c, key.caseId, { kind: "rerun" }),
      );
      return c.json(state, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cases/{id}/complete",
      tags: ["Case room"],
      summary: "Complete a waiting case as a person",
      description:
        "Runs the checks and the schema's success condition first, the same rule the agent meets. Approvals the agent's code declares still apply, so the case may stay waiting on one.",
      request: { params: CaseParam },
      responses: {
        200: json(RoomState, "Completed, or waiting on an approval"),
        409: error(
          "The case is not waiting, or its checks or success condition fail",
        ),
      },
    }),
    async (c) => {
      const { key, status } = await loadCase(c, c.req.valid("param").id, true);
      if (status !== "waiting")
        throw new ApiError(
          409,
          "case_not_completable",
          `The case is ${status}.`,
        );
      const outcome = await runtime(c).completeCase(key);
      if (outcome.result === "refused")
        throw new ApiError(409, outcome.code, outcome.message);
      await withOrg(c.env, c.var.org, (tx) =>
        recordReview(tx, c, key.caseId, { kind: "completed" }),
      );
      return c.json(outcome.state, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/cases/{id}/files",
      tags: ["Case room"],
      summary: "The files attached to a case, oldest first",
      request: { params: CaseParam },
      responses: {
        200: json(z.object({ files: z.array(File) }), "The case's files"),
        404: error("Not visible"),
      },
    }),
    async (c) => {
      const { key } = await loadCase(c, c.req.valid("param").id, false);
      const rows = await withOrg(c.env, c.var.org, (tx) =>
        tx
          .select()
          .from(files)
          .where(eq(files.caseId, key.caseId))
          .orderBy(asc(files.createdAt)),
      );
      return c.json(
        {
          files: rows.map((f) => ({
            id: f.id,
            name: f.name,
            contentType: f.contentType,
            size: f.size,
            createdAt: f.createdAt.toISOString(),
          })),
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/cases/{id}/files/{file}",
      tags: ["Case room"],
      summary: "Download one of a case's files",
      description:
        "Streams the file's bytes for anyone who can see the case. It is always sent as an attachment in a sandbox, so a file never runs as a page on the app's origin.",
      request: { params: CaseParam.extend({ file: z.string() }) },
      responses: {
        200: {
          content: {
            "application/octet-stream": {
              schema: z.any().openapi({ type: "string", format: "binary" }),
            },
          },
          description: "The file's bytes, with its content type",
        },
        404: error("No such case or file"),
      },
    }),
    async (c) => {
      const params = c.req.valid("param");
      const { key } = await loadCase(c, params.id, false);
      const [row] = await withOrg(c.env, c.var.org, (tx) =>
        tx
          .select()
          .from(files)
          .where(and(eq(files.id, params.file), eq(files.caseId, key.caseId))),
      );
      const object = row && (await c.env.FILES.get(row.r2Key));
      if (!row || !object)
        throw new ApiError(404, "not_found", "No such file.");
      return c.body(object.body, 200, {
        "content-type": row.contentType,
        "content-length": String(row.size),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        "content-security-policy": "sandbox",
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      });
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cases/{id}/files",
      tags: ["Case room"],
      summary: "Attach uploaded files to a case",
      description:
        "Takes ids from POST /files that belong to no case yet. A queued case starts with them; otherwise the agent gets them on its next run, read by OCR when the agent switched OCR on.",
      request: {
        params: CaseParam,
        ...body(z.object({ files: z.array(z.string()).min(1).max(20) })),
      },
      responses: {
        200: json(z.object({ files: z.array(File) }), "Attached"),
        409: error("The case is cancelled"),
        422: error("A file does not exist or belongs to a case"),
      },
    }),
    async (c) => {
      const { key, status } = await loadCase(c, c.req.valid("param").id, true);
      if (status === "cancelled")
        throw new ApiError(409, "case_cancelled", "The case is cancelled.");
      const wanted = [...new Set(c.req.valid("json").files)];
      const attached = await withOrg(c.env, c.var.org, async (tx) => {
        const rows = await tx
          .update(files)
          .set({ caseId: key.caseId })
          .where(and(inArray(files.id, wanted), isNull(files.caseId)))
          .returning();
        if (rows.length !== wanted.length)
          throw new ApiError(
            422,
            "invalid_files",
            "Each file must come from POST /files and belong to no case yet.",
          );
        // A queued case reads its files when it starts; a started one hears
        // about them on its next run.
        if (status !== "queued")
          for (const f of rows)
            await recordReview(tx, c, key.caseId, {
              kind: "file.added",
              after: { id: f.id, name: f.name, contentType: f.contentType },
            });
        return rows;
      });
      return c.json(
        {
          files: attached.map((f) => ({
            id: f.id,
            name: f.name,
            contentType: f.contentType,
            size: f.size,
            createdAt: f.createdAt.toISOString(),
          })),
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cases/{id}/cancel",
      tags: ["Case room"],
      summary: "Cancel the case; no webhook is sent",
      request: { params: CaseParam },
      responses: { 204: { description: "Cancelled" } },
    }),
    async (c) => {
      const { key, status } = await loadCase(c, c.req.valid("param").id, true);
      if (status === "cancelled" || status === "completed")
        return c.body(null, 204);
      // A queued case has not reached the runtime; its start is skipped.
      if (status !== "queued") await runtime(c).cancelCase(key);
      await withOrg(c.env, c.var.org, async (tx) => {
        await tx
          .update(cases)
          .set({
            status: "cancelled",
            waitingOnGroupId: null,
            updatedAt: new Date(),
          })
          .where(eq(cases.id, key.caseId));
        await recordReview(tx, c, key.caseId, { kind: "cancelled" });
        await audit(tx, {
          ...eventBase(c.var),
          action: "case.cancelled",
          targetType: "case",
          targetId: key.caseId,
          caseId: key.caseId,
        });
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/cases/{id}/assignees",
      tags: ["Cases"],
      summary: "Replace the people assigned to a case",
      description:
        "API keys, Owners and Admins. Each person must be able to see the case. Agent code never assigns.",
      request: {
        params: CaseParam,
        ...body(z.object({ userIds: z.array(z.string()).max(50) })),
      },
      responses: {
        200: json(
          z.object({ assignees: z.array(z.object({ id: z.string() })) }),
          "The case's assignees",
        ),
        403: error("Only API keys, Owners and Admins assign"),
        404: error("No such case"),
        422: error("A person cannot see the case"),
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const id = c.req.valid("param").id;
      const { key } = await loadCase(c, id, false);
      const wanted = [...new Set(c.req.valid("json").userIds)];
      const rows = await withOrg(c.env, c.var.org, async (tx) => {
        const members = wanted.length
          ? await tx
              .select({ userId: member.userId, role: member.role })
              .from(member)
              .where(
                and(
                  eq(member.organizationId, c.var.org),
                  inArray(member.userId, wanted),
                ),
              )
          : [];
        for (const userId of wanted) {
          const found = members.find((m) => m.userId === userId);
          const caller = found && {
            type: "person" as const,
            userId,
            role: found.role as OrgRole,
          };
          if (
            !caller ||
            !canSeeCase(caller, await agentRole(tx, caller, key.agentId))
          )
            throw new ApiError(
              422,
              "assignee_without_access",
              `${userId} cannot see this case.`,
            );
        }
        const current = (
          await tx
            .select({ userId: caseAssignees.userId })
            .from(caseAssignees)
            .where(eq(caseAssignees.caseId, id))
        ).map((a) => a.userId);
        const added = wanted.filter((u) => !current.includes(u));
        const removed = current.filter((u) => !wanted.includes(u));
        if (removed.length)
          await tx
            .delete(caseAssignees)
            .where(
              and(
                eq(caseAssignees.caseId, id),
                inArray(caseAssignees.userId, removed),
              ),
            );
        const outbox = [];
        const assignedAt = new Date();
        for (const userId of added) {
          await tx.insert(caseAssignees).values({
            organizationId: c.var.org,
            caseId: id,
            userId,
            assignedBy: personId(c),
            assignedAt,
          });
          outbox.push(
            await notifyLater(tx, c.var.org, {
              type: "assigned",
              caseId: id,
              userId,
              assignedAt: assignedAt.toISOString(),
            }),
          );
        }
        if (added.length || removed.length)
          await audit(tx, {
            ...eventBase(c.var),
            action: "case.assignees.updated",
            targetType: "case",
            targetId: id,
            caseId: id,
            data: { added, removed },
          });
        return outbox;
      });
      if (rows.length) await drainOutbox(c.env, c.var.org, rows);
      return c.json({ assignees: wanted.map((u) => ({ id: u })) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cases/{id}/approvals/{approval}/approve",
      tags: ["Case room"],
      summary: "Approve what the agent's code asked a person to approve",
      request: {
        params: ApprovalParam,
        ...body(z.object({ note: z.string().max(2000).optional() })),
      },
      responses: {
        200: json(RoomState, "The case after the decision"),
        403: error(
          "Only members of the approving group, or any operator when the code names none",
        ),
        404: error("No such approval"),
        409: error("Already decided, or the case is running"),
      },
    }),
    async (c) => {
      const { id, approval } = c.req.valid("param");
      return decideApproval(c, id, approval, true, c.req.valid("json").note);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cases/{id}/approvals/{approval}/reject",
      tags: ["Case room"],
      summary: "Reject it, with the reason the agent and the thread see",
      request: {
        params: ApprovalParam,
        ...body(z.object({ reason: z.string().trim().min(1).max(2000) })),
      },
      responses: {
        200: json(RoomState, "The case after the decision"),
        403: error(
          "Only members of the approving group, or any operator when the code names none",
        ),
        404: error("No such approval"),
        409: error("Already decided, or the case is running"),
      },
    }),
    async (c) => {
      const { id, approval } = c.req.valid("param");
      return decideApproval(c, id, approval, false, c.req.valid("json").reason);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/ocr",
      tags: ["OCR"],
      summary: "OCR an uploaded PDF or page image",
      request: {
        params: OrgParam,
        ...body(
          z.object({
            file: z
              .string()
              .openapi({ description: "A file id from POST /files" }),
            grounding: z.boolean().default(false),
          }),
        ),
      },
      responses: {
        200: json(
          z.object({
            pages: z.array(
              z.object({
                index: z.number(),
                markdown: z.string(),
                blocks: z
                  .array(
                    z.object({
                      label: z.string(),
                      bbox: z.tuple([
                        z.number(),
                        z.number(),
                        z.number(),
                        z.number(),
                      ]),
                      text: z.string(),
                    }),
                  )
                  .optional(),
              }),
            ),
            model: z.string(),
          }),
          "The pages as Markdown",
        ),
        402: error("The organization has reached its spending limit"),
        404: error("No such file"),
        415: error("Not a PDF or page image"),
      },
    }),
    async (c) => {
      const input = c.req.valid("json");
      await withOrg(c.env, c.var.org, refuseOverLimit);
      const { pages, model } = await ocrFile(
        c.env,
        c.var.org,
        input.file,
        input.grounding,
      );
      return c.json({ pages, model }, 200);
    },
  );
