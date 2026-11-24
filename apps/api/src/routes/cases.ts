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
import { asc, eq } from "drizzle-orm";
import type { Context } from "hono";

import { agentRole, canSeeCase, canWorkCase, mayApprove } from "../access.ts";
import { eventBase } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import { ApiError, createCase, type Approval } from "../cases.ts";
import type { Env, WriteResult } from "../env.ts";
import { ocrFile } from "../ocr.ts";
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
      const notes = await withOrg(c.env, c.var.org, async (tx) => {
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
        return events
          .filter((e) => e.kind !== "rerun" && (!since || e.at > since))
          .map(({ kind, path, before, after }) => ({
            kind,
            path,
            before,
            after,
          }));
      });
      const state = await runtime(c).rerun({ ...key, notes });
      await withOrg(c.env, c.var.org, (tx) =>
        recordReview(tx, c, key.caseId, { kind: "rerun" }),
      );
      return c.json(state, 200);
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
      return c.json(
        await ocrFile(c.env, c.var.org, input.file, input.grounding),
        200,
      );
    },
  );
