// Support requests that arrive without a session (PRE-155): the signed-out
// contact form, behind Turnstile, and email to support@preprocess.com, which
// Google forwards to requests@SUPPORT_INBOUND_DOMAIN, whose Email Routing
// hands it to this Worker's email() handler. Hosted only, like support.ts.

import { orgId, withoutOrg } from "@preprocess/db/client";
import { member, user } from "@preprocess/db/schema/auth";
import {
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_CATEGORIES,
  supportRequests,
} from "@preprocess/db/schema/support";
import { and, eq, sql } from "drizzle-orm";
import PostalMime from "postal-mime";
import { z } from "zod";

import type { Env } from "./env.ts";
import {
  createSupportRequest,
  findRequest,
  postCustomerMessage,
  REPLY_ADDRESS,
  storeSupportAttachment,
  supportEnabled,
} from "./support.ts";
import type { SupportRequestRow } from "./support.ts";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Server-side Turnstile check. Staging, previews and local development use
// Cloudflare's always-pass test secret; production its real one.
export const verifyTurnstile = async (
  env: Env,
  token: string,
  ip: string | null,
) => {
  if (!env.SUPPORT_TURNSTILE_SECRET_KEY) return false;
  const form = new FormData();
  form.append("secret", env.SUPPORT_TURNSTILE_SECRET_KEY);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const response = await fetch(SITEVERIFY, { method: "POST", body: form });
  if (!response.ok) return false;
  const result = await response.json<{ success?: boolean }>();
  return result.success === true;
};

const SignedOutRequest = z.object({
  email: z.email().max(320),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000),
  category: z.enum(SUPPORT_CATEGORIES),
  turnstileToken: z.string().max(2048).optional(),
});

const refuse = (status: 400 | 403 | 503, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

// POST /api/support/requests: a signed-out visitor's request, with no
// organization. Rate-limited by client address in index.ts.
export const signedOutRequest = async (env: Env, request: Request) => {
  const parsed = SignedOutRequest.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return refuse(
      400,
      "invalid_request",
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; "),
    );
  const input = parsed.data;
  if (!env.SUPPORT_TURNSTILE_SECRET_KEY)
    return refuse(
      503,
      "unavailable",
      "The contact form isn't available right now. Email support@preprocess.com instead.",
    );
  if (!input.turnstileToken)
    return refuse(
      400,
      "turnstile_required",
      "Complete the check, then send again.",
    );
  const ip = request.headers.get("cf-connecting-ip");
  if (!(await verifyTurnstile(env, input.turnstileToken, ip)))
    return refuse(
      403,
      "turnstile_failed",
      "The check didn't pass. Try it again, then send.",
    );
  const row = await createSupportRequest(
    env,
    {
      organizationId: null,
      requesterUserId: null,
      requesterEmail: input.email.toLowerCase(),
      subject: input.subject,
      body: input.body,
      category: input.category,
      severity: 3,
      channel: "form",
    },
    { actorType: "platform", actorId: "support:visitor", uploadedBy: null },
  );
  return Response.json(
    {
      id: row.id,
      subject: row.subject,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    },
    { status: 201 },
  );
};

// A reply's own words: quoted history, its "On … wrote:" line and anything
// under a forwarded or original-message header are dropped.
export const stripQuoted = (text: string) => {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1] ?? "";
    if (
      /^On\s.+wrote:\s*$/.test(line) ||
      (/^On\s/.test(line) && /wrote:\s*$/.test(next)) ||
      /^-{2,}\s*(Original|Forwarded) Message\s*-{2,}/i.test(line) ||
      /^_{10,}\s*$/.test(line) ||
      (kept.some((l) => l.trim()) && /^From:\s/.test(line))
    )
      break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
};

const htmlToText = (html: string) =>
  html
    .replace(/<(br|\/p|\/div|\/li|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

// The one member an address belongs to: their user and organization when
// they are a member of exactly one.
const memberOf = async (env: Env, address: string) =>
  withoutOrg(env, "support email: match the sender", async (tx) => {
    const rows = await tx
      .select({ userId: user.id, organizationId: member.organizationId })
      .from(user)
      .innerJoin(member, eq(member.userId, user.id))
      .where(sql`lower(${user.email}) = ${address}`);
    return rows.length === 1 ? rows[0]! : null;
  });

// Whether the sender may add to this request: its requester, or a member of
// its organization.
const maySend = async (env: Env, row: SupportRequestRow, address: string) => {
  if (row.requesterEmail.toLowerCase() === address) return true;
  if (!row.organizationId) return false;
  const [found] = await withoutOrg(
    env,
    "support email: sender's membership",
    (tx) =>
      tx
        .select({ id: member.id })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(
          and(
            eq(member.organizationId, row.organizationId!),
            sql`lower(${user.email}) = ${address}`,
          ),
        ),
  );
  return Boolean(found);
};

export type InboundEmail = {
  // The envelope's sender and recipient.
  from: string;
  to: string;
  raw: ReadableStream<Uint8Array> | ArrayBuffer | string;
};

// The email() handler's work: a reply threads onto its request by the
// r+<token>@ address it was sent to; anything else is a new request (channel
// email), in the sender's organization when they are a member of exactly
// one. Attachments over 25 MB are left out. Auto-replies are ignored.
export const receiveSupportEmail = async (env: Env, message: InboundEmail) => {
  if (!supportEnabled(env)) return { result: "ignored" as const };
  const email = await PostalMime.parse(message.raw);
  const autoSubmitted = email.headers.find(
    (h) => h.key === "auto-submitted",
  )?.value;
  const sender = (email.from?.address ?? message.from).trim().toLowerCase();
  const ours = env.SUPPORT_EMAIL_FROM?.match(/<([^>]+)>/)?.[1]?.toLowerCase();
  if (
    (autoSubmitted && autoSubmitted.toLowerCase() !== "no") ||
    sender === ours
  )
    return { result: "ignored" as const };
  const text = stripQuoted(
    email.text ?? (email.html ? htmlToText(email.html) : ""),
  );
  const recipients = [
    message.to,
    ...(email.to ?? []).map((a) => a.address ?? ""),
    ...(email.cc ?? []).map((a) => a.address ?? ""),
  ];
  const token = recipients
    .map((a) => REPLY_ADDRESS.exec(a.trim())?.[1]?.toLowerCase())
    .find(Boolean);
  const threaded = token
    ? await withoutOrg(env, "support email: thread a reply", async (tx) => {
        const [row] = await tx
          .select({ id: supportRequests.id })
          .from(supportRequests)
          .where(eq(supportRequests.replyToken, token));
        return row ? findRequest(env, row.id) : null;
      })
    : null;
  const files = (email.attachments ?? []).filter((a) => {
    const size =
      typeof a.content === "string" ? a.content.length : a.content.byteLength;
    return size <= SUPPORT_ATTACHMENT_MAX_BYTES;
  });
  const by = {
    actorType: "platform" as const,
    actorId: "support:email",
    uploadedBy: null,
  };

  let row: SupportRequestRow;
  let messageId: string | null = null;
  if (threaded && (await maySend(env, threaded, sender))) {
    row = threaded;
    const posted = await postCustomerMessage(
      env,
      row,
      {
        body: text || "(no text)",
        via: "email",
        authorUserId: null,
      },
      by,
    );
    messageId = posted.id;
  } else {
    const matched = await memberOf(env, sender);
    row = await createSupportRequest(
      env,
      {
        organizationId: matched ? orgId(matched.organizationId) : null,
        requesterUserId: matched?.userId ?? null,
        requesterEmail: sender,
        subject: email.subject?.trim().slice(0, 200) || "(no subject)",
        body: text || "(no text)",
        category: "other",
        severity: 3,
        channel: "email",
      },
      by,
    );
  }
  for (const file of files)
    await storeSupportAttachment(env, {
      organizationId: row.organizationId,
      requestId: row.id,
      messageId,
      uploadedBy: null,
      filename: file.filename ?? "attachment",
      contentType: file.mimeType || "application/octet-stream",
      bytes:
        typeof file.content === "string"
          ? new TextEncoder().encode(file.content)
          : new Uint8Array(file.content),
    });
  return {
    result:
      threaded && row.id === threaded.id
        ? ("threaded" as const)
        : ("created" as const),
    requestId: row.id,
    attachments: files.length,
    skipped: (email.attachments?.length ?? 0) - files.length,
  };
};
