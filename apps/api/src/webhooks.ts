// Outbound webhooks (design doc 06): Standard Webhooks signatures, one
// delivery row per matching endpoint written with the case index change that
// caused it, sent through the outbox to the WEBHOOKS queue, retried with
// backoff for 24 hours, and logged.

import { orgId, withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { member, organization, user } from "@preprocess/db/schema/auth";
import { cases, idempotencyKeys } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import type { webhookEvents } from "@preprocess/db/schema/webhooks";
import {
  webhookDeliveries,
  webhookEndpoints,
} from "@preprocess/db/schema/webhooks";
import {
  and,
  arrayContains,
  eq,
  gt,
  inArray,
  isNull,
  max,
  min,
  or,
} from "drizzle-orm";

import { decrypt, encrypt, orgKey, orgKeyVersion } from "./crypto.ts";
import { caseRoomUrl } from "./notify.ts";
import type { Env } from "./env.ts";
import { readOutbox, writeOutbox } from "./outbox.ts";
import type { OutboxMessage } from "./outbox.ts";

export type WebhookEventType = (typeof webhookEvents)[number];

const MAX_ANSWERS_BYTES = 256 * 1024;
const RETRY_FOR_MS = 24 * 60 * 60 * 1000;
const DISABLE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
// 30 s, 2 m, 10 m, 30 m, 1 h, then every 3 h.
const BACKOFF_SECONDS = [30, 120, 600, 1800, 3600];
const backoff = (attempt: number) => BACKOFF_SECONDS[attempt - 1] ?? 3 * 3600;

// whsec_ and 24 random bytes, base64: the Standard Webhooks secret format.
export const newSigningSecret = () =>
  `whsec_${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))}`;

const secretAad = (org: string, endpointId: string, version: number) =>
  `${org}|${endpointId}|${version}`;

export const sealSecret = async (
  env: Env,
  tx: Tx,
  org: string,
  endpointId: string,
  secret: string,
) => {
  const { version, key } = await orgKey(env, tx, org);
  return {
    keyVersion: version,
    signingSecret: await encrypt(
      key,
      secret,
      secretAad(org, endpointId, version),
    ),
  };
};

const openSecret = async (
  env: Env,
  tx: Tx,
  org: string,
  endpointId: string,
  version: number,
  box: Uint8Array,
) =>
  decrypt(
    await orgKeyVersion(env, tx, org, version),
    box,
    secretAad(org, endpointId, version),
  );

// v1,base64(HMAC-SHA256(key, "{id}.{timestamp}.{body}")) where the key is the
// secret's base64 part, decoded.
export const sign = async (
  secret: string,
  id: string,
  timestamp: number,
  body: string,
) => {
  const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) =>
    c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${id}.${timestamp}.${body}`),
    ),
  );
  return `v1,${btoa(String.fromCharCode(...mac))}`;
};

// No requests to internal hosts: IP literals in private, loopback,
// link-local and unique-local ranges, and localhost itself.
export const refusedHost = (url: URL) => {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost") return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (host.includes(":"))
    return (
      host === "::" ||
      host === "::1" ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host) ||
      host.startsWith("::ffff:")
    );
  return false;
};

type StatusChange = {
  caseId: string;
  agentId: string;
  status: "completed" | "failed" | "waiting";
  group: { id: string; slug: string; name: string } | null;
  reason: string | null;
  answers: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  // What the group is asked to approve, when that is why the case waits.
  approval?: {
    id: string;
    level: "completion" | "field" | "tool";
    target: string;
    payload: unknown;
  };
};

const eventType = (change: StatusChange): WebhookEventType =>
  change.status === "completed"
    ? "case.completed"
    : change.status === "failed"
      ? "case.failed"
      : "case.needs_group";

// Inside the case index write: one delivery per matching endpoint, and one
// outbox row each. Returns the outbox rows to drain after commit.
export const queueWebhooks = async (
  env: Env,
  tx: Tx,
  org: string,
  change: StatusChange,
) => {
  const type = eventType(change);
  const endpoints = await tx
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.enabled, true),
        arrayContains(webhookEndpoints.events, [type]),
        or(
          isNull(webhookEndpoints.agentIds),
          arrayContains(webhookEndpoints.agentIds, [change.agentId]),
        ),
      ),
    );
  if (endpoints.length === 0) return [];
  const [ref] = await tx
    .select({
      agentSlug: agents.slug,
      deploymentId: cases.deploymentId,
      environment: deployments.environment,
      source: cases.source,
      orgSlug: organization.slug,
    })
    .from(cases)
    .innerJoin(agents, eq(agents.id, cases.agentId))
    .innerJoin(deployments, eq(deployments.id, cases.deploymentId))
    .innerJoin(organization, eq(organization.id, cases.organizationId))
    .where(eq(cases.id, change.caseId));
  if (!ref) return [];
  const [key] = await tx
    .select({ key: idempotencyKeys.key })
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.caseId, change.caseId));
  const statusUrl = new URL(
    `/v1/orgs/${org}/cases/${change.caseId}`,
    env.APP_URL,
  ).href;
  const caseRef = {
    id: change.caseId,
    agent: { id: change.agentId, slug: ref.agentSlug },
    deployment: { id: ref.deploymentId, environment: ref.environment },
    status: change.status,
    source: ref.source,
    idempotencyKey: key?.key ?? null,
    url: caseRoomUrl(env, change.agentId, change.caseId),
    statusUrl,
  };
  const answersFit =
    change.answers !== null &&
    new TextEncoder().encode(JSON.stringify(change.answers)).length <
      MAX_ANSWERS_BYTES;
  const data =
    type === "case.completed"
      ? {
          case: caseRef,
          answers: answersFit ? change.answers : null,
          answersUrl: statusUrl,
        }
      : type === "case.failed"
        ? {
            case: caseRef,
            error: change.error ?? {
              code: "failed",
              message: change.reason ?? "The case failed.",
            },
          }
        : {
            case: caseRef,
            group: change.group,
            reason: change.reason,
            ...(change.approval && { approval: change.approval }),
          };
  const outboxIds: string[] = [];
  for (const endpoint of endpoints) {
    const id = newId("delivery");
    await tx.insert(webhookDeliveries).values({
      id,
      organizationId: org,
      endpointId: endpoint.id,
      eventType: type,
      caseId: change.caseId,
      payload: {
        id,
        type,
        createdAt: new Date().toISOString(),
        organization: { id: org, slug: ref.orgSlug },
        data,
      },
      status: "pending",
      nextAttemptAt: new Date(),
    });
    outboxIds.push(await writeOutbox(tx, org, "webhook", { deliveryId: id }));
  }
  return outboxIds;
};

// The WEBHOOKS consumer: one attempt at one delivery. Returns a delay in
// seconds when it should be tried again.
export const deliverWebhook = async (
  env: Env,
  message: OutboxMessage,
): Promise<number | null> => {
  const row = await readOutbox(env, message);
  if (!row) return null;
  const { deliveryId } = row.payload as { deliveryId: string };
  const org = orgId(message.organizationId);
  const target = await withOrg(env, org, async (tx) => {
    const [found] = await tx
      .select({ delivery: webhookDeliveries, endpoint: webhookEndpoints })
      .from(webhookDeliveries)
      .innerJoin(
        webhookEndpoints,
        eq(webhookEndpoints.id, webhookDeliveries.endpointId),
      )
      .where(eq(webhookDeliveries.id, deliveryId));
    if (
      !found ||
      found.delivery.status !== "pending" ||
      !found.endpoint.enabled
    )
      return null;
    const e = found.endpoint;
    const secrets = [
      await openSecret(env, tx, org, e.id, e.keyVersion, e.signingSecret),
    ];
    if (
      e.previousSigningSecret &&
      e.previousKeyVersion !== null &&
      e.previousExpiresAt &&
      e.previousExpiresAt > new Date()
    )
      secrets.push(
        await openSecret(
          env,
          tx,
          org,
          e.id,
          e.previousKeyVersion,
          e.previousSigningSecret,
        ),
      );
    return { delivery: found.delivery, url: e.url, secrets };
  });
  if (!target) return null;

  const body = JSON.stringify(target.delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  let statusCode: number | null = null;
  let error: string | null = null;
  const url = new URL(target.url);
  if (url.protocol !== "https:" || refusedHost(url))
    error = "refused: the URL is not a public https address";
  else
    try {
      const signatures = await Promise.all(
        target.secrets.map((s) => sign(s, deliveryId, timestamp, body)),
      );
      const response = await fetch(url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "content-type": "application/json",
          "webhook-id": deliveryId,
          "webhook-timestamp": String(timestamp),
          "webhook-signature": signatures.join(" "),
        },
        body,
      });
      statusCode = response.status;
      await response.body?.cancel();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

  const delivered =
    statusCode !== null && statusCode >= 200 && statusCode < 300;
  const attempts = target.delivery.attempts + 1;
  const expired =
    Date.now() - target.delivery.createdAt.getTime() >= RETRY_FOR_MS;
  const retryIn = delivered || expired ? null : backoff(attempts);
  await withOrg(env, org, async (tx) => {
    await tx
      .update(webhookDeliveries)
      .set({
        status: delivered
          ? "delivered"
          : retryIn === null
            ? "failed"
            : "pending",
        attempts,
        lastStatusCode: statusCode,
        lastError: delivered ? null : (error ?? `HTTP ${statusCode}`),
        nextAttemptAt:
          retryIn === null ? null : new Date(Date.now() + retryIn * 1000),
        deliveredAt: delivered ? new Date() : null,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    if (!delivered) await disableIfFailing(env, tx, target.delivery.endpointId);
  });
  return retryIn;
};

// An endpoint that has failed every delivery for 3 days is disabled, and the
// organization's Owners and Admins are emailed.
const disableIfFailing = async (env: Env, tx: Tx, endpointId: string) => {
  const [stats] = await tx
    .select({
      lastDelivered: max(webhookDeliveries.deliveredAt),
      firstAttempt: min(webhookDeliveries.createdAt),
    })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.endpointId, endpointId),
        gt(webhookDeliveries.attempts, 0),
      ),
    );
  const since = Date.now() - DISABLE_AFTER_MS;
  if (
    !stats?.firstAttempt ||
    stats.firstAttempt.getTime() > since ||
    (stats.lastDelivered && stats.lastDelivered.getTime() > since)
  )
    return;
  const [endpoint] = await tx
    .update(webhookEndpoints)
    .set({
      enabled: false,
      disabledReason: "Every delivery failed for 3 days.",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(webhookEndpoints.id, endpointId),
        eq(webhookEndpoints.enabled, true),
      ),
    )
    .returning({
      url: webhookEndpoints.url,
      organizationId: webhookEndpoints.organizationId,
    });
  if (!endpoint) return;
  const admins = await tx
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, endpoint.organizationId),
        inArray(member.role, ["owner", "admin"]),
      ),
    );
  const link = new URL("/developers/webhooks", env.APP_URL).href;
  for (const admin of admins)
    await env.EMAIL.send({
      from: env.EMAIL_FROM,
      to: admin.email,
      subject: "A Preprocess webhook endpoint was disabled",
      text: [
        `Every delivery to ${endpoint.url} failed for 3 days, so the endpoint was disabled.`,
        "",
        `Fix the receiver, then enable it again: ${link}`,
      ].join("\n"),
    });
};
