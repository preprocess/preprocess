// Support requests (support center spec, PRE-155), hosted only: our cloud's
// customers ask for help by form, email, the API or MCP, and every channel
// makes the same request. A request is a row in the customer's organization
// and, when SUPPORT_ORG_ID and SUPPORT_AGENT_ID are set, a case in our own
// Preprocess Support organization for its support agent. Without them a
// request is still recorded and acknowledged by email.
//
// Requests from signed-out visitors and unmatched emails have no
// organization; they are read and written on DB_SYSTEM. Every read of a
// customer's own data on a request's behalf is audited in that organization
// (auditSupportContextRead).

import { audit, canonical } from "@preprocess/db/audit";
import type { AuditActorType } from "@preprocess/db/audit";
import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
import type { OrgId, Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { idempotencyKeys } from "@preprocess/db/schema/cases";
import {
  SUPPORT_ATTACHMENT_MAX_BYTES,
  supportAttachments,
  supportMessages,
  supportRequests,
} from "@preprocess/db/schema/support";
import type {
  SupportAuthorKind,
  SupportCategory,
  SupportChannel,
} from "@preprocess/db/schema/support";
import type { ProductProperties } from "@preprocess/logs";
import { runMode } from "@preprocess/runmode";
import { and, asc, eq, inArray, lt } from "drizzle-orm";

import { trackEvent } from "./analytics.ts";
import { ApiError, createCase } from "./cases.ts";
import { supportReceivedEmail, supportReplyEmail } from "./email-templates.ts";
import type { RenderedEmail } from "./email-templates.ts";
import { emailBrand } from "./email.ts";
import type { Env } from "./env.ts";
import { getPlan } from "./plan.ts";
import type { Plan } from "./plan.ts";

export type SupportRequestRow = typeof supportRequests.$inferSelect;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Our cloud only. A self-hosted install has no support intake, and its Help
// menu points elsewhere (spec, Privacy and data).
export const supportEnabled = (env: Env) => runMode(env).kind === "cloud";

// Business hours are 9:00 to 17:00 Pacific, Monday to Friday; holidays are
// not counted out. Each step re-reads the local time, so DST changes land
// on the right hour.
const PACIFIC = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});
const OPENS = 9;
const CLOSES = 17;

export const addBusinessHours = (from: Date, hours: number) => {
  let at = from.getTime();
  let left = hours * 60;
  while (left > 0) {
    const parts = Object.fromEntries(
      PACIFIC.formatToParts(new Date(at)).map((p) => [p.type, p.value]),
    );
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);
    const open =
      parts.weekday !== "Sat" &&
      parts.weekday !== "Sun" &&
      hour >= OPENS &&
      hour < CLOSES;
    if (open) {
      const step = Math.min(left, (CLOSES - hour) * 60 - minute);
      at += step * MINUTE;
      left -= step;
    } else at += (60 - minute) * MINUTE;
  }
  return new Date(at);
};

// First response, by plan and severity (spec, SLAs). A business day is 8
// business hours. Free is best effort; Enterprise severity 1 runs around the
// clock.
const SLA: Partial<
  Record<Plan["name"], Record<1 | 2 | 3, { hours: number; clock?: true }>>
> = {
  team: { 1: { hours: 8 }, 2: { hours: 8 }, 3: { hours: 16 } },
  enterprise: {
    1: { hours: 1, clock: true },
    2: { hours: 4 },
    3: { hours: 8 },
  },
};

export const firstResponseDue = (
  plan: string | null,
  severity: 1 | 2 | 3,
  from: Date,
): Date | null => {
  const target = plan ? SLA[plan as Plan["name"]]?.[severity] : undefined;
  if (!target) return null;
  return target.clock
    ? new Date(from.getTime() + target.hours * HOUR)
    : addBusinessHours(from, target.hours);
};

// 26 lowercase base32 characters: mail systems may lowercase a local part.
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
export const newReplyToken = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(26)),
    (b) => ALPHABET[b % 32],
  ).join("");

export const REPLY_ADDRESS = /^r\+([a-z2-7]{26})@/i;

export const supportR2Key = (
  org: string | null,
  requestId: string | null,
  attachmentId: string,
) => `support/${org ?? "visitor"}/${requestId ?? "uploads"}/${attachmentId}`;

// The request's page in the app, for a requester with an account.
export const requestUrl = (env: Env, row: SupportRequestRow) =>
  row.organizationId && row.requesterUserId
    ? new URL(`/support/requests/${row.id}`, env.APP_URL).href
    : null;

// Support email goes out only where SUPPORT_EMAIL_FROM is set: production,
// and local development's send_email sink. Staging sends none. Replies thread
// back through r+<token>@SUPPORT_INBOUND_DOMAIN where inbound mail is set up.
const sendSupportEmail = async (
  env: Env,
  row: SupportRequestRow,
  email: RenderedEmail,
) => {
  if (!env.SUPPORT_EMAIL_FROM) {
    console.log(
      JSON.stringify({ event: "support.email.skipped", requestId: row.id }),
    );
    return;
  }
  try {
    await env.EMAIL.send({
      from: env.SUPPORT_EMAIL_FROM,
      to: row.requesterEmail,
      ...email,
      ...(env.SUPPORT_INBOUND_DOMAIN && {
        replyTo: `r+${row.replyToken}@${env.SUPPORT_INBOUND_DOMAIN}`,
      }),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "support.email.failed",
        requestId: row.id,
        error: String(error),
      }),
    );
  }
};

// A request's own organization's transaction, or DB_SYSTEM's for one with
// none.
const inScope = <T>(
  env: Env,
  org: string | null,
  reason: string,
  fn: (tx: Tx) => Promise<T>,
) => (org ? withOrg(env, orgId(org), fn) : withoutOrg(env, reason, fn));

export const findRequest = async (env: Env, requestId: string) => {
  const [row] = await withoutOrg(env, "support: find a request", (tx) =>
    tx.select().from(supportRequests).where(eq(supportRequests.id, requestId)),
  );
  return row ?? null;
};

export type AuditActor = {
  actorType: AuditActorType;
  actorId: string;
  ip?: string | null;
  requestId?: string | null;
};

// Attachments a caller uploaded before sending a request: theirs, in this
// organization, not yet sent with one.
const bindAttachments = async (
  tx: Tx,
  ids: string[],
  org: string | null,
  uploadedBy: string | null,
  requestId: string,
  messageId: string,
) => {
  if (!ids.length) return;
  const unique = [...new Set(ids)];
  const found = await tx
    .select({
      id: supportAttachments.id,
      requestId: supportAttachments.requestId,
    })
    .from(supportAttachments)
    .where(
      and(
        inArray(supportAttachments.id, unique),
        org ? eq(supportAttachments.organizationId, org) : undefined,
        uploadedBy ? eq(supportAttachments.uploadedBy, uploadedBy) : undefined,
      ),
    );
  const usable = found.filter(
    (a) => a.requestId === null || a.requestId === requestId,
  );
  if (usable.length !== unique.length)
    throw new ApiError(404, "not_found", "No such attachment.");
  await tx
    .update(supportAttachments)
    .set({ requestId, messageId })
    .where(inArray(supportAttachments.id, unique));
};

export type NewSupportRequest = {
  organizationId: OrgId | null;
  requesterUserId: string | null;
  requesterEmail: string;
  subject: string;
  body: string;
  category: SupportCategory;
  severity: 1 | 2 | 3;
  channel: SupportChannel;
  agentId?: string | null | undefined;
  caseRef?: string | null | undefined;
  attachments?: string[] | undefined;
};

const sha256 = async (text: string) =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

// A repeated Idempotency-Key with the same body gets the first request back,
// as POST /cases does.
const claimIdempotencyKey = async (
  tx: Tx,
  org: OrgId,
  key: string,
  fingerprint: Uint8Array,
): Promise<string | null> => {
  const where = and(
    eq(idempotencyKeys.organizationId, org),
    eq(idempotencyKeys.operation, "support.requests.create"),
    eq(idempotencyKeys.key, key),
  );
  const now = new Date();
  await tx
    .delete(idempotencyKeys)
    .where(and(where, lt(idempotencyKeys.expiresAt, now)));
  const [inserted] = await tx
    .insert(idempotencyKeys)
    .values({
      organizationId: org,
      operation: "support.requests.create",
      key,
      fingerprint,
      expiresAt: new Date(now.getTime() + DAY),
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  if (inserted) return null;
  const [existing] = await tx.select().from(idempotencyKeys).where(where);
  if (!existing || !sameBytes(existing.fingerprint, fingerprint))
    throw new ApiError(
      422,
      "idempotency_mismatch",
      "This Idempotency-Key was used with a different request.",
    );
  const id = (existing.responseBody as { id?: string } | null)?.id;
  if (!id)
    throw new ApiError(
      409,
      "idempotency_in_progress",
      "A request with this Idempotency-Key is still being processed.",
    );
  return id;
};

// What the support agent's case says: the request as the customer wrote it
// and where it came from, nothing else of theirs.
const caseText = (row: SupportRequestRow, body: string) =>
  [
    `Support request ${row.id}`,
    `Organization: ${row.organizationId ?? "none (signed out)"}`,
    `Plan: ${row.planAtSubmit ?? "none"}`,
    `Channel: ${row.channel}`,
    `Category: ${row.category}`,
    `Severity: ${row.severity}`,
    ...(row.agentId ? [`Agent: ${row.agentId}`] : []),
    ...(row.caseRef ? [`Case: ${row.caseRef}`] : []),
    ...(row.firstResponseDueAt
      ? [`First response due: ${row.firstResponseDueAt.toISOString()}`]
      : []),
    "",
    `Subject: ${row.subject}`,
    "",
    body,
  ].join("\n");

// The request's case in Preprocess Support. A failure (the agent not deployed
// yet, say) leaves the request recorded without one.
const openSupportCase = async (
  env: Env,
  row: SupportRequestRow,
  body: string,
) => {
  if (!env.SUPPORT_ORG_ID || !env.SUPPORT_AGENT_ID) return null;
  try {
    const { body: accepted } = await createCase(
      env,
      orgId(env.SUPPORT_ORG_ID),
      { agent: env.SUPPORT_AGENT_ID, text: caseText(row, body), files: [] },
      { source: "api", createdBy: "support", actorType: "platform" },
      `support:${row.id}`,
    );
    await inScope(env, row.organizationId, "support: link the case", (tx) =>
      tx
        .update(supportRequests)
        .set({ supportCaseId: accepted.id })
        .where(eq(supportRequests.id, row.id)),
    );
    return accepted.id;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "support.case.failed",
        requestId: row.id,
        error: String(error),
      }),
    );
    return null;
  }
};

export const createSupportRequest = async (
  env: Env,
  input: NewSupportRequest,
  by: AuditActor & { uploadedBy: string | null },
  idempotencyKey?: string,
): Promise<SupportRequestRow> => {
  const org = input.organizationId;
  const planAtSubmit = org ? (await getPlan(env, org)).name : null;
  const now = new Date();
  const created = await inScope(
    env,
    org,
    "support: a signed-out request",
    async (tx) => {
      if (org && idempotencyKey) {
        const fingerprint = await sha256(
          `${canonical({ ...input, attachments: input.attachments ?? [] })}\n${by.actorId}`,
        );
        const replayed = await claimIdempotencyKey(
          tx,
          org,
          idempotencyKey,
          fingerprint,
        );
        if (replayed) {
          const [row] = await tx
            .select()
            .from(supportRequests)
            .where(eq(supportRequests.id, replayed));
          if (row) return { row, replayed: true };
        }
      }
      const id = newId("supportRequest");
      const [row] = await tx
        .insert(supportRequests)
        .values({
          id,
          organizationId: org,
          requesterUserId: input.requesterUserId,
          requesterEmail: input.requesterEmail,
          subject: input.subject,
          category: input.category,
          severity: input.severity,
          status: "open",
          channel: input.channel,
          planAtSubmit,
          agentId: input.agentId ?? null,
          caseRef: input.caseRef ?? null,
          replyToken: newReplyToken(),
          firstResponseDueAt: firstResponseDue(
            planAtSubmit,
            input.severity,
            now,
          ),
        })
        .returning();
      const messageId = newId("supportMessage");
      await tx.insert(supportMessages).values({
        id: messageId,
        requestId: id,
        organizationId: org,
        authorKind: "customer",
        authorUserId: input.requesterUserId,
        body: input.body,
        via: input.channel,
      });
      await bindAttachments(
        tx,
        input.attachments ?? [],
        org,
        by.uploadedBy,
        id,
        messageId,
      );
      if (org) {
        await audit(tx, {
          organizationId: org,
          actorType: by.actorType,
          actorId: by.actorId,
          ip: by.ip ?? null,
          requestId: by.requestId ?? null,
          action: "support.request.created",
          targetType: "support_request",
          targetId: id,
          data: {
            channel: input.channel,
            category: input.category,
            severity: input.severity,
            attachments: input.attachments?.length ?? 0,
          },
        });
        if (idempotencyKey)
          await tx
            .update(idempotencyKeys)
            .set({ responseBody: { id } })
            .where(
              and(
                eq(idempotencyKeys.organizationId, org),
                eq(idempotencyKeys.operation, "support.requests.create"),
                eq(idempotencyKeys.key, idempotencyKey),
              ),
            );
      }
      return { row: row!, replayed: false };
    },
  );
  if (created.replayed) return created.row;
  const plan = created.row.planAtSubmit;
  await trackEvent(env, "support_request_created", org, input.requesterUserId, {
    request_id: created.row.id,
    channel: input.channel,
    category: input.category.replaceAll(
      "-",
      "_",
    ) as ProductProperties<"support_request_created">["category"],
    severity: input.severity,
    plan:
      plan === "free" ||
      plan === "team" ||
      plan === "enterprise" ||
      plan === "internal"
        ? plan
        : "none",
  });
  const caseId = await openSupportCase(env, created.row, input.body);
  const row = { ...created.row, supportCaseId: caseId };
  await sendSupportEmail(
    env,
    row,
    supportReceivedEmail(emailBrand(env), {
      url: requestUrl(env, row),
      requestId: row.id,
      subject: row.subject,
      body: input.body,
      dueAt: row.firstResponseDueAt,
    }),
  );
  return row;
};

// A customer adds to their request, by the app, the API or a reply email.
// It waits on us again, a solved one included.
export const postCustomerMessage = async (
  env: Env,
  row: SupportRequestRow,
  message: {
    body: string;
    via: SupportChannel;
    authorUserId: string | null;
    attachments?: string[] | undefined;
  },
  by: AuditActor & { uploadedBy: string | null },
) =>
  inScope(
    env,
    row.organizationId,
    "support: a signed-out reply",
    async (tx) => {
      const id = newId("supportMessage");
      const [created] = await tx
        .insert(supportMessages)
        .values({
          id,
          requestId: row.id,
          organizationId: row.organizationId,
          authorKind: "customer",
          authorUserId: message.authorUserId,
          body: message.body,
          via: message.via,
        })
        .returning();
      await bindAttachments(
        tx,
        message.attachments ?? [],
        row.organizationId,
        by.uploadedBy,
        row.id,
        id,
      );
      await tx
        .update(supportRequests)
        .set({ status: "waiting_on_us", solvedAt: null, updatedAt: new Date() })
        .where(eq(supportRequests.id, row.id));
      if (row.organizationId)
        await audit(tx, {
          organizationId: row.organizationId,
          actorType: by.actorType,
          actorId: by.actorId,
          ip: by.ip ?? null,
          requestId: by.requestId ?? null,
          action: "support.request.replied",
          targetType: "support_request",
          targetId: row.id,
          data: {
            via: message.via,
            attachments: message.attachments?.length ?? 0,
          },
        });
      return created!;
    },
  );

// The customer marks their request solved.
export const solveSupportRequest = (
  env: Env,
  row: SupportRequestRow,
  by: AuditActor,
) =>
  inScope(env, row.organizationId, "support: solve", async (tx) => {
    const [updated] = await tx
      .update(supportRequests)
      .set({ status: "solved", solvedAt: new Date(), updatedAt: new Date() })
      .where(eq(supportRequests.id, row.id))
      .returning();
    if (row.organizationId)
      await audit(tx, {
        organizationId: row.organizationId,
        actorType: by.actorType,
        actorId: by.actorId,
        ip: by.ip ?? null,
        requestId: by.requestId ?? null,
        action: "support.request.solved",
        targetType: "support_request",
        targetId: row.id,
      });
    return updated!;
  });

// For the support agent layer: our reply to a request, by the support agent
// or an operator. It is stored, waits on the customer (or is solved), is
// emailed to the requester and shows in their sidebar notices until they
// open the request. The first response that counts toward the SLA is an
// operator's, or the agent's when it solves the request (spec, SLAs).
export const postSupportReply = async (
  env: Env,
  requestId: string,
  reply: {
    authorKind: Exclude<SupportAuthorKind, "customer">;
    body: string;
    solves?: boolean;
    // The operator, a user in Preprocess Support.
    authorUserId?: string | null;
  },
) => {
  const row = await findRequest(env, requestId);
  if (!row) throw new Error(`no support request ${requestId}`);
  const solves = reply.solves === true;
  const now = new Date();
  const counts = reply.authorKind === "operator" || solves;
  const updated = await inScope(
    env,
    row.organizationId,
    "support: our reply on a signed-out request",
    async (tx) => {
      const [message] = await tx
        .insert(supportMessages)
        .values({
          id: newId("supportMessage"),
          requestId,
          organizationId: row.organizationId,
          authorKind: reply.authorKind,
          authorUserId: reply.authorUserId ?? null,
          body: reply.body,
          via: null,
        })
        .returning();
      const [next] = await tx
        .update(supportRequests)
        .set({
          status: solves ? "solved" : "waiting_on_customer",
          ...(solves && { solvedAt: now }),
          ...(counts &&
            !row.firstResponseAt && {
              firstResponseAt: now,
              firstResponseSolved: solves,
            }),
          ...(row.requesterUserId && { requesterNoticeAt: now }),
          updatedAt: now,
        })
        .where(eq(supportRequests.id, requestId))
        .returning();
      if (row.organizationId)
        await audit(tx, {
          organizationId: row.organizationId,
          ...supportActor(env, reply.authorKind, reply.authorUserId ?? null),
          action: solves
            ? "support.request.solved"
            : "support.request.answered",
          targetType: "support_request",
          targetId: requestId,
        });
      return { request: next!, message: message! };
    },
  );
  await sendSupportEmail(
    env,
    updated.request,
    supportReplyEmail(emailBrand(env), {
      url: requestUrl(env, updated.request),
      requestId,
      subject: row.subject,
      body: reply.body,
      solved: solves,
    }),
  );
  return updated;
};

// Who acts for Preprocess Support in a customer's audit log: the support
// agent, or an operator by their user id in our own organization.
const supportActor = (
  env: Env,
  kind: "agent" | "operator",
  operatorId: string | null,
) =>
  kind === "agent"
    ? ({
        actorType: "agent",
        actorId: env.SUPPORT_AGENT_ID ?? "support-agent",
      } as const)
    : ({
        actorType: "platform",
        actorId: `support:${operatorId ?? "operator"}`,
      } as const);

// For the support agent layer: record that the agent or an operator read the
// customer's own data (plan, usage, errors, deploy status) for this request.
// It lands in the requesting organization's audit log, and only there.
export const auditSupportContextRead = async (
  env: Env,
  requestId: string,
  read: {
    by: "agent" | "operator";
    operatorId?: string | null;
    // What was read, as names: "plan", "usage", "errors", "deployments".
    what: string[];
    // Ids the read named, such as an agent or case id.
    targets?: string[];
  },
) => {
  const row = await findRequest(env, requestId);
  if (!row) throw new Error(`no support request ${requestId}`);
  if (!row.organizationId)
    throw new Error(`support request ${requestId} has no organization`);
  return withOrg(env, orgId(row.organizationId), (tx) =>
    audit(tx, {
      organizationId: row.organizationId!,
      ...supportActor(env, read.by, read.operatorId ?? null),
      action: "support.context_read",
      targetType: "support_request",
      targetId: requestId,
      caseId: row.supportCaseId,
      data: { what: read.what, targets: read.targets ?? [] },
    }),
  );
};

export const storeSupportAttachment = async (
  env: Env,
  file: {
    organizationId: string | null;
    requestId: string | null;
    messageId?: string | null;
    uploadedBy: string | null;
    filename: string;
    contentType: string;
    bytes: Uint8Array;
  },
) => {
  if (file.bytes.length > SUPPORT_ATTACHMENT_MAX_BYTES)
    throw new ApiError(413, "too_large", "Attachments are at most 25 MB.");
  const id = newId("supportAttachment");
  const r2Key = supportR2Key(file.organizationId, file.requestId, id);
  await env.FILES.put(r2Key, file.bytes, {
    httpMetadata: { contentType: file.contentType },
  });
  const [row] = await inScope(
    env,
    file.organizationId,
    "support: an emailed attachment",
    (tx) =>
      tx
        .insert(supportAttachments)
        .values({
          id,
          requestId: file.requestId,
          messageId: file.messageId ?? null,
          organizationId: file.organizationId,
          uploadedBy: file.uploadedBy,
          r2Key,
          filename: file.filename.slice(0, 255) || "attachment",
          contentType: file.contentType,
          sizeBytes: file.bytes.length,
        })
        .returning(),
  );
  return row!;
};

// Support objects live under support/; anything else is refused rather than
// deleted.
const deleteSupportKeys = async (env: Env, keys: string[]) => {
  const foreign = keys.find((k) => !k.startsWith("support/"));
  if (foreign) throw new Error(`refusing to delete ${foreign} as support data`);
  for (let i = 0; i < keys.length; i += 1000)
    await env.FILES.delete(keys.slice(i, i + 1000));
};

// An organization's deletion removes its support rows by cascade; this removes
// their R2 objects (auth.ts, afterDeleteOrganization).
export const deleteSupportObjects = async (env: Env, org: string) => {
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({
      prefix: `support/${org}/`,
      ...(cursor && { cursor }),
    });
    await deleteSupportKeys(
      env,
      page.objects.map((o) => o.key),
    );
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
};

// Solved requests are kept 2 years after they were solved, attachments 1 year
// after they were uploaded (spec, Privacy and data). From the daily retention
// sweep (retention.ts), in batches, across every organization and the
// requests that have none. Each organization's purge is one audit event.
export const SUPPORT_RETENTION = { requestDays: 730, attachmentDays: 365 };
const SUPPORT_BATCH = 200;
const SUPPORT_MAX_BATCHES = 50;

export const sweepSupportRetention = async (env: Env, now = new Date()) => {
  const requestCutoff = new Date(
    now.getTime() - SUPPORT_RETENTION.requestDays * DAY,
  );
  const attachmentCutoff = new Date(
    now.getTime() - SUPPORT_RETENTION.attachmentDays * DAY,
  );
  const purged = new Map<string, { requests: number; attachments: number }>();
  const count = (
    org: string | null,
    kind: "requests" | "attachments",
    n: number,
  ) => {
    if (!org) return;
    const counts = purged.get(org) ?? { requests: 0, attachments: 0 };
    counts[kind] += n;
    purged.set(org, counts);
  };
  for (let batch = 0; batch < SUPPORT_MAX_BATCHES; batch++) {
    const taken = await withoutOrg(env, "support retention", async (tx) => {
      const due = await tx
        .select({
          id: supportAttachments.id,
          r2Key: supportAttachments.r2Key,
          org: supportAttachments.organizationId,
        })
        .from(supportAttachments)
        .where(lt(supportAttachments.createdAt, attachmentCutoff))
        .orderBy(asc(supportAttachments.id))
        .limit(SUPPORT_BATCH)
        .for("update");
      if (!due.length) return 0;
      await deleteSupportKeys(
        env,
        due.map((a) => a.r2Key),
      );
      await tx.delete(supportAttachments).where(
        inArray(
          supportAttachments.id,
          due.map((a) => a.id),
        ),
      );
      for (const a of due) count(a.org, "attachments", 1);
      return due.length;
    });
    if (taken < SUPPORT_BATCH) break;
  }
  for (let batch = 0; batch < SUPPORT_MAX_BATCHES; batch++) {
    const taken = await withoutOrg(env, "support retention", async (tx) => {
      const due = await tx
        .select({ id: supportRequests.id, org: supportRequests.organizationId })
        .from(supportRequests)
        .where(
          and(
            eq(supportRequests.status, "solved"),
            lt(supportRequests.solvedAt, requestCutoff),
          ),
        )
        .orderBy(asc(supportRequests.id))
        .limit(SUPPORT_BATCH)
        .for("update");
      if (!due.length) return 0;
      const ids = due.map((r) => r.id);
      const files = await tx
        .select({ r2Key: supportAttachments.r2Key })
        .from(supportAttachments)
        .where(inArray(supportAttachments.requestId, ids));
      await deleteSupportKeys(
        env,
        files.map((f) => f.r2Key),
      );
      await tx.delete(supportRequests).where(inArray(supportRequests.id, ids));
      for (const r of due) count(r.org, "requests", 1);
      return due.length;
    });
    if (taken < SUPPORT_BATCH) break;
  }
  for (const [org, counts] of purged)
    await withOrg(env, orgId(org), (tx) =>
      audit(tx, {
        organizationId: org,
        actorType: "platform",
        actorId: "retention",
        action: "support.retention.purged",
        targetType: "organization",
        targetId: org,
        data: {
          requestCutoff: requestCutoff.toISOString(),
          attachmentCutoff: attachmentCutoff.toISOString(),
          counts,
        },
      }),
    );
};
