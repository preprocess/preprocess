// Support requests in the API (PRE-155): a customer's requests in their own
// organization. A Member sees only the requests they made; Owners, Admins and
// organization API keys see every request in the organization. Hosted only:
// index.ts answers 404 for all of these on a self-hosted install.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { withOrg } from "@preprocess/db/client";
import { user } from "@preprocess/db/schema/auth";
import {
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_CATEGORIES,
  SUPPORT_CHANNELS,
  SUPPORT_STATUSES,
  supportAttachments,
  supportMessages,
  supportRequests,
} from "@preprocess/db/schema/support";
import { and, asc, desc, eq, isNotNull, lt, or } from "drizzle-orm";
import type { Context } from "hono";

import { actor } from "../caller.ts";
import type { Caller, OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import type { Env } from "../env.ts";
import {
  createSupportRequest,
  postCustomerMessage,
  solveSupportRequest,
  storeSupportAttachment,
} from "../support.ts";
import type { SupportRequestRow } from "../support.ts";

type Ctx = Context<{ Bindings: Env; Variables: OrgVariables }>;

const OrgParam = z.object({ org: z.string() });
const RequestParam = OrgParam.extend({ id: z.string() });

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

// Our replies show as Preprocess Support, whoever wrote them.
const STAFF_NAME = "Preprocess Support";

const SupportRequest = z
  .object({
    id: z.string(),
    subject: z.string(),
    category: z.enum(SUPPORT_CATEGORIES),
    severity: z.number().int().min(1).max(3),
    status: z.enum(SUPPORT_STATUSES),
    channel: z.enum(SUPPORT_CHANNELS),
    requester: z.object({ userId: z.string().nullable(), email: z.string() }),
    planAtSubmit: z.string().nullable(),
    agentId: z.string().nullable(),
    caseRef: z.string().nullable(),
    incidentRef: z.string().nullable(),
    firstResponseDueAt: z.string().nullable(),
    firstResponseAt: z.string().nullable(),
    solvedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("SupportRequest");

const SupportAttachment = z
  .object({
    id: z.string(),
    messageId: z.string().nullable(),
    filename: z.string(),
    contentType: z.string(),
    size: z.number(),
    createdAt: z.string(),
  })
  .openapi("SupportAttachment");

const SupportMessage = z
  .object({
    id: z.string(),
    authorKind: z.enum(["customer", "agent", "operator"]),
    authorName: z.string(),
    body: z.string(),
    via: z.enum(SUPPORT_CHANNELS).nullable(),
    createdAt: z.string(),
  })
  .openapi("SupportMessage");

const SupportRequestDetail = SupportRequest.extend({
  messages: z.array(SupportMessage),
  attachments: z.array(SupportAttachment),
}).openapi("SupportRequestDetail");

const iso = (d: Date | null) => d?.toISOString() ?? null;

const present = (row: SupportRequestRow): z.infer<typeof SupportRequest> => ({
  id: row.id,
  subject: row.subject,
  category: row.category,
  severity: row.severity,
  status: row.status,
  channel: row.channel,
  requester: { userId: row.requesterUserId, email: row.requesterEmail },
  planAtSubmit: row.planAtSubmit,
  agentId: row.agentId,
  caseRef: row.caseRef,
  incidentRef: row.incidentRef,
  firstResponseDueAt: iso(row.firstResponseDueAt),
  firstResponseAt: iso(row.firstResponseAt),
  solvedAt: iso(row.solvedAt),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const presentAttachment = (a: typeof supportAttachments.$inferSelect) => ({
  id: a.id,
  messageId: a.messageId,
  filename: a.filename,
  contentType: a.contentType,
  size: a.sizeBytes,
  createdAt: a.createdAt.toISOString(),
});

const seesAll = (caller: Caller) =>
  caller.type === "api_key" ||
  caller.role === "owner" ||
  caller.role === "admin";

// The requests a caller may see: their own, or all of them for Owners,
// Admins and API keys.
const visible = (caller: Caller) =>
  seesAll(caller)
    ? undefined
    : eq(
        supportRequests.requesterUserId,
        caller.type === "person" ? caller.userId : "",
      );

const callerId = (caller: Caller) =>
  caller.type === "person" ? caller.userId : caller.keyId;

const by = (c: Ctx) => ({
  ...actor(c.var.caller),
  ip: c.var.request.ip,
  requestId: c.var.request.requestId,
  uploadedBy: callerId(c.var.caller),
});

const loadRequest = async (c: Ctx, id: string) => {
  const [row] = await withOrg(c.env, c.var.org, (tx) =>
    tx
      .select()
      .from(supportRequests)
      .where(and(eq(supportRequests.id, id), visible(c.var.caller))),
  );
  if (!row) throw new ApiError(404, "not_found", "No such support request.");
  return row;
};

const channelOf = (c: Ctx, client: string | undefined) =>
  c.var.caller.type === "person" ? "form" : client === "mcp" ? "mcp" : "api";

const readUpload = async (c: Ctx) => {
  const form = await c.req.formData();
  const upload = form.get("file");
  if (!upload || typeof upload === "string")
    throw new ApiError(400, "invalid_request", 'Send the file as "file".');
  if (upload.size > SUPPORT_ATTACHMENT_MAX_BYTES)
    throw new ApiError(413, "too_large", "Attachments are at most 25 MB.");
  return {
    filename: upload.name || "attachment",
    contentType: upload.type || "application/octet-stream",
    bytes: new Uint8Array(await upload.arrayBuffer()),
  };
};

const Upload = {
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
};

const Attachments = z
  .array(z.string())
  .max(10)
  .default([])
  .openapi({ description: "Ids from POST /support/attachments" });

const CreateSupportRequest = z
  .object({
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(50_000),
    category: z.enum(SUPPORT_CATEGORIES),
    severity: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(3),
    agent: z
      .string()
      .max(200)
      .optional()
      .openapi({ description: "An agent this is about" }),
    case: z
      .string()
      .max(200)
      .optional()
      .openapi({ description: "A case this is about" }),
    email: z.email().optional().openapi({
      description:
        "Where replies go. Required with an API key; a signed-in person's own email otherwise.",
    }),
    attachments: Attachments,
  })
  .openapi("CreateSupportRequest");

const ListQuery = z.object({
  status: z.enum(SUPPORT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const Notice = z
  .object({
    requestId: z.string(),
    subject: z.string(),
    status: z.enum(SUPPORT_STATUSES),
    at: z.string(),
  })
  .openapi("SupportNotice");

export const supportRoutes = new OpenAPIHono<{
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
      path: "/support/attachments",
      tags: ["Support"],
      summary: "Upload an attachment to send with a new support request",
      request: { params: OrgParam, ...Upload },
      responses: {
        201: json(SupportAttachment, "Stored"),
        400: error("No file"),
        413: error("Over 25 MB"),
      },
    }),
    async (c) => {
      const file = await readUpload(c);
      const row = await storeSupportAttachment(c.env, {
        ...file,
        organizationId: c.var.org,
        requestId: null,
        uploadedBy: callerId(c.var.caller),
      });
      return c.json(presentAttachment(row), 201);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/support/requests",
      tags: ["Support"],
      summary: "Ask Preprocess Support for help",
      description:
        "Records the request in this organization and emails the requester an acknowledgement. Replies arrive by email and in GET /support/requests/{id}.",
      request: {
        params: OrgParam,
        headers: z.object({
          "idempotency-key": z.string().min(1).max(255).optional(),
          "x-preprocess-client": z.string().optional(),
        }),
        ...body(CreateSupportRequest),
      },
      responses: {
        201: json(SupportRequest, "Recorded"),
        400: error("Body fails validation, or an API key sent no email"),
        404: error("An attachment isn't yours to send"),
        409: error("The same Idempotency-Key is still in progress"),
        422: error("Same Idempotency-Key, different request"),
      },
    }),
    async (c) => {
      const input = c.req.valid("json");
      const headers = c.req.valid("header");
      const caller = c.var.caller;
      let email = input.email;
      if (caller.type === "person") {
        const [person] = await withOrg(c.env, c.var.org, (tx) =>
          tx
            .select({ email: user.email })
            .from(user)
            .where(eq(user.id, caller.userId)),
        );
        email = person?.email;
      }
      if (!email)
        throw new ApiError(
          400,
          "invalid_request",
          "email: an API key's request needs an email address for replies.",
        );
      const row = await createSupportRequest(
        c.env,
        {
          organizationId: c.var.org,
          requesterUserId: caller.type === "person" ? caller.userId : null,
          requesterEmail: email,
          subject: input.subject,
          body: input.body,
          category: input.category,
          severity: input.severity,
          channel: channelOf(c, headers["x-preprocess-client"]),
          agentId: input.agent ?? null,
          caseRef: input.case ?? null,
          attachments: input.attachments,
        },
        by(c),
        headers["idempotency-key"],
      );
      return c.json(present(row), 201);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/support/requests",
      tags: ["Support"],
      summary: "Support requests, newest first",
      description:
        "A Member sees the requests they made; Owners, Admins and API keys see every request in the organization.",
      request: { params: OrgParam, query: ListQuery },
      responses: {
        200: json(
          z.object({
            items: z.array(SupportRequest),
            nextCursor: z.string().nullable(),
          }),
          "A page of requests",
        ),
        400: error("Bad cursor"),
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
      const rows = await withOrg(c.env, c.var.org, (tx) =>
        tx
          .select()
          .from(supportRequests)
          .where(
            and(
              visible(c.var.caller),
              query.status
                ? eq(supportRequests.status, query.status)
                : undefined,
              after
                ? or(
                    lt(supportRequests.createdAt, new Date(after[0])),
                    and(
                      eq(supportRequests.createdAt, new Date(after[0])),
                      lt(supportRequests.id, after[1]),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(supportRequests.createdAt), desc(supportRequests.id))
          .limit(query.limit + 1),
      );
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return c.json(
        {
          items: page.map(present),
          nextCursor:
            rows.length > query.limit && last
              ? btoa(JSON.stringify([last.createdAt.toISOString(), last.id]))
              : null,
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/support/requests/{id}",
      tags: ["Support"],
      summary: "A support request with its thread and attachments",
      description:
        "Our replies are from Preprocess Support. Opening a request clears its notice for the person who made it.",
      request: { params: RequestParam },
      responses: {
        200: json(SupportRequestDetail, "The request"),
        404: error("No such request, or not yours"),
      },
    }),
    async (c) => {
      const row = await loadRequest(c, c.req.valid("param").id);
      const caller = c.var.caller;
      const detail = await withOrg(c.env, c.var.org, async (tx) => {
        const messages = await tx
          .select({ message: supportMessages, name: user.name })
          .from(supportMessages)
          .leftJoin(user, eq(user.id, supportMessages.authorUserId))
          .where(eq(supportMessages.requestId, row.id))
          .orderBy(asc(supportMessages.createdAt), asc(supportMessages.id));
        const attachments = await tx
          .select()
          .from(supportAttachments)
          .where(eq(supportAttachments.requestId, row.id))
          .orderBy(asc(supportAttachments.createdAt));
        if (
          row.requesterNoticeAt &&
          caller.type === "person" &&
          caller.userId === row.requesterUserId
        )
          await tx
            .update(supportRequests)
            .set({ requesterNoticeAt: null })
            .where(eq(supportRequests.id, row.id));
        return { messages, attachments };
      });
      return c.json(
        {
          ...present(row),
          messages: detail.messages.map(({ message, name }) => ({
            id: message.id,
            authorKind: message.authorKind,
            authorName:
              message.authorKind === "customer"
                ? name?.trim() || row.requesterEmail
                : STAFF_NAME,
            body: message.body,
            via: message.via,
            createdAt: message.createdAt.toISOString(),
          })),
          attachments: detail.attachments.map(presentAttachment),
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/support/requests/{id}/messages",
      tags: ["Support"],
      summary: "Reply on a support request",
      description:
        "Adds to the thread and moves the request to waiting on us, a solved request included.",
      request: {
        params: RequestParam,
        headers: z.object({ "x-preprocess-client": z.string().optional() }),
        ...body(
          z.object({
            body: z.string().trim().min(1).max(50_000),
            attachments: Attachments,
          }),
        ),
      },
      responses: {
        201: json(SupportMessage, "Added"),
        404: error("No such request or attachment"),
      },
    }),
    async (c) => {
      const row = await loadRequest(c, c.req.valid("param").id);
      const input = c.req.valid("json");
      const caller = c.var.caller;
      const message = await postCustomerMessage(
        c.env,
        row,
        {
          body: input.body,
          via: channelOf(c, c.req.valid("header")["x-preprocess-client"]),
          authorUserId: caller.type === "person" ? caller.userId : null,
          attachments: input.attachments,
        },
        by(c),
      );
      const [person] =
        caller.type === "person"
          ? await withOrg(c.env, c.var.org, (tx) =>
              tx
                .select({ name: user.name })
                .from(user)
                .where(eq(user.id, caller.userId)),
            )
          : [];
      return c.json(
        {
          id: message.id,
          authorKind: "customer" as const,
          authorName: person?.name.trim() || row.requesterEmail,
          body: message.body,
          via: message.via,
          createdAt: message.createdAt.toISOString(),
        },
        201,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/support/requests/{id}/solve",
      tags: ["Support"],
      summary: "Mark a support request solved",
      request: { params: RequestParam },
      responses: {
        200: json(SupportRequest, "Solved"),
        404: error("No such request"),
      },
    }),
    async (c) => {
      const row = await loadRequest(c, c.req.valid("param").id);
      const solved = await solveSupportRequest(c.env, row, by(c));
      return c.json(present(solved), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/support/requests/{id}/attachments",
      tags: ["Support"],
      summary: "Add an attachment to a support request",
      request: { params: RequestParam, ...Upload },
      responses: {
        201: json(SupportAttachment, "Stored"),
        400: error("No file"),
        404: error("No such request"),
        413: error("Over 25 MB"),
      },
    }),
    async (c) => {
      const row = await loadRequest(c, c.req.valid("param").id);
      const file = await readUpload(c);
      const stored = await storeSupportAttachment(c.env, {
        ...file,
        organizationId: c.var.org,
        requestId: row.id,
        uploadedBy: callerId(c.var.caller),
      });
      return c.json(presentAttachment(stored), 201);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/support/attachments/{id}",
      tags: ["Support"],
      summary: "Download a support request's attachment",
      description:
        "For anyone who can see the request (or, before it is sent, who uploaded it). Always sent as an attachment in a sandbox.",
      request: { params: RequestParam },
      responses: {
        200: {
          content: {
            "application/octet-stream": {
              schema: z.any().openapi({ type: "string", format: "binary" }),
            },
          },
          description: "The attachment's bytes",
        },
        404: error("No such attachment"),
      },
    }),
    async (c) => {
      const id = c.req.valid("param").id;
      const caller = c.var.caller;
      const [found] = await withOrg(c.env, c.var.org, (tx) =>
        tx
          .select({
            attachment: supportAttachments,
            requester: supportRequests.requesterUserId,
          })
          .from(supportAttachments)
          .leftJoin(
            supportRequests,
            eq(supportRequests.id, supportAttachments.requestId),
          )
          .where(eq(supportAttachments.id, id)),
      );
      const allowed =
        found &&
        (found.attachment.requestId
          ? seesAll(caller) ||
            (caller.type === "person" && found.requester === caller.userId)
          : found.attachment.uploadedBy === callerId(caller));
      const object = allowed && (await c.env.FILES.get(found.attachment.r2Key));
      if (!found || !object)
        throw new ApiError(404, "not_found", "No such attachment.");
      const a = found.attachment;
      return c.body(object.body, 200, {
        "content-type": a.contentType,
        "content-length": String(a.sizeBytes),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
        "content-security-policy": "sandbox",
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      });
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/support/notices",
      tags: ["Support"],
      summary:
        "The signed-in person's requests with a reply they haven't opened",
      description:
        "For the app's sidebar notice stack. Opening the request clears its notice.",
      request: { params: OrgParam },
      responses: { 200: json(z.object({ items: z.array(Notice) }), "Notices") },
    }),
    async (c) => {
      const caller = c.var.caller;
      if (caller.type !== "person") return c.json({ items: [] }, 200);
      const rows = await withOrg(c.env, c.var.org, (tx) =>
        tx
          .select()
          .from(supportRequests)
          .where(
            and(
              eq(supportRequests.requesterUserId, caller.userId),
              isNotNull(supportRequests.requesterNoticeAt),
            ),
          )
          .orderBy(desc(supportRequests.requesterNoticeAt))
          .limit(20),
      );
      return c.json(
        {
          items: rows.map((r) => ({
            requestId: r.id,
            subject: r.subject,
            status: r.status,
            at: r.requesterNoticeAt!.toISOString(),
          })),
        },
        200,
      );
    },
  );
