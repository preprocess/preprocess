// Creating, starting and indexing cases (design doc 04). Routes, schedules and
// MCP create through createCase; the CASES queue starts them; the runtime
// reports back through the Platform entrypoint, the one writer of the index.

import { audit, canonical } from "@preprocess/db/audit";
import type { AuditActorType } from "@preprocess/db/audit";
import { orgId, withOrg } from "@preprocess/db/client";
import type { OrgId, Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agentGrants, agents, groups } from "@preprocess/db/schema/access";
import {
  caseApprovals,
  caseMentions,
  cases,
  files,
  idempotencyKeys,
} from "@preprocess/db/schema/cases";
import { sandboxIntervals } from "@preprocess/db/schema/billing";
import { deployments } from "@preprocess/db/schema/deployments";
import { mcpServers } from "@preprocess/db/schema/mcp";
import { amountBucket, durationBucket } from "@preprocess/logs";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { agentRole, canSeeCase, canWorkCase } from "./access.ts";
import { assertModelAllowed } from "./allowed-models.ts";
import type { Caller } from "./caller.ts";
import type { Manifest } from "./deploy.ts";
import { modelSlug, trackEvent } from "./analytics.ts";
import { acceptedMemories } from "./memories.ts";
import type { Env, GroupRef, StartCase } from "./env.ts";
import { drainOutbox, readOutbox, writeOutbox } from "./outbox.ts";
import { creditStop, entitlement, MICRO_USD_PER_CREDIT } from "./billing.ts";
import { customImagesAllowed } from "./plan.ts";
import { indexCase } from "./case-search.ts";
import { joinAutomaticSuite } from "./evals.ts";
import { meter, meterCaseFee, meterCharges, type Charges } from "./metering.ts";
import { effectiveSettings } from "./settings.ts";
import { refuseOverLimit } from "./spend.ts";
import { notifyLater } from "./notify.ts";
import { queueWebhooks } from "./webhooks.ts";
import type { OutboxKind, OutboxMessage } from "./outbox.ts";

// Errors in doc 04's shape: { error: { code, message } }, with any details
// a client acts on beside them (model_in_use's refs).
export class ApiError extends HTTPException {
  readonly code: string;
  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(status, {
      message,
      res: Response.json({ error: { code, message, ...details } }, { status }),
    });
    this.code = code;
  }
}

export type CaseSource = (typeof cases.source.enumValues)[number];
export type CaseStatus = (typeof cases.status.enumValues)[number];

export type CreateCase = {
  agent: string;
  deployment?: string | undefined;
  text?: string | undefined;
  files: string[];
};

export type Creator = {
  source: CaseSource;
  // Who the case is by: a user id, an API key id or a schedule name.
  createdBy: string;
  actorType: AuditActorType;
  // A person or key is checked for access; schedules run as the platform.
  caller?: Caller;
  requestId?: string | null;
  ip?: string | null;
};

export type CaseAccepted = {
  id: string;
  status: "queued";
  statusUrl: string;
  createdAt: string;
};

const DAY = 24 * 60 * 60 * 1000;

const sha256 = async (text: string) =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

export const statusUrl = (env: Env, org: string, caseId: string) =>
  new URL(`/v1/orgs/${org}/cases/${caseId}`, env.APP_URL).href;

export const findAgent = async (tx: Tx, agent: string) => {
  const [found] = await tx
    .select({ id: agents.id, slug: agents.slug })
    .from(agents)
    .where(
      and(
        or(eq(agents.id, agent), eq(agents.slug, agent)),
        isNull(agents.archivedAt),
      ),
    );
  return found ?? null;
};

// Commits the case, its audit event and its start in one transaction, then
// hands the start to the queue. A repeated Idempotency-Key with the same body
// returns the first response.
export const createCase = async (
  env: Env,
  org: OrgId,
  input: CreateCase,
  by: Creator,
  idempotencyKey?: string,
): Promise<{ body: CaseAccepted; replayed: boolean }> => {
  // A plan must be started first; a payment past due for 7 days stops new
  // cases until it's paid; Free caps its monthly cases (spec 16a), and Free
  // and Team need credits left (PRE-96).
  const entitled = await entitlement(env, org, "cases");
  if (entitled === "plan_required")
    throw new ApiError(
      402,
      "plan_required",
      "This organization has no plan yet. Its Owner can start one, Free included, in Billing.",
    );
  if (entitled === "past_due")
    throw new ApiError(
      402,
      "payment_past_due",
      "The last payment failed more than 7 days ago. An Owner can update the card in Billing.",
    );
  if (entitled === "used_up")
    throw new ApiError(
      402,
      "credit_exhausted",
      "This organization has used this month's cases on its plan. Upgrade to start more.",
    );
  if ((await creditStop(env, org)) === "used_up")
    throw new ApiError(
      402,
      "credit_exhausted",
      "Credit balance is empty. An Owner can add credits in Billing.",
    );
  // Free pauses agents that run in a custom environment (PRE-96); they
  // resume when the plan allows custom environments again.
  const customEnvironments = await customImagesAllowed(env, org);
  const created = await withOrg(env, org, async (tx) => {
    const now = new Date();
    if (idempotencyKey) {
      const fingerprint = await sha256(`${canonical(input)}\n${by.createdBy}`);
      const key = and(
        eq(idempotencyKeys.organizationId, org),
        eq(idempotencyKeys.operation, "cases.create"),
        eq(idempotencyKeys.key, idempotencyKey),
      );
      await tx
        .delete(idempotencyKeys)
        .where(and(key, lt(idempotencyKeys.expiresAt, now)));
      const [inserted] = await tx
        .insert(idempotencyKeys)
        .values({
          organizationId: org,
          operation: "cases.create",
          key: idempotencyKey,
          fingerprint,
          expiresAt: new Date(now.getTime() + DAY),
        })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key });
      if (!inserted) {
        const [existing] = await tx.select().from(idempotencyKeys).where(key);
        if (!existing || !sameBytes(existing.fingerprint, fingerprint))
          throw new ApiError(
            422,
            "idempotency_mismatch",
            "This Idempotency-Key was used with a different request.",
          );
        if (!existing.responseBody)
          throw new ApiError(
            409,
            "idempotency_in_progress",
            "A request with this Idempotency-Key is still being processed.",
          );
        return {
          body: existing.responseBody as CaseAccepted,
          replayed: true as const,
        };
      }
    }

    const agent = await findAgent(tx, input.agent);
    if (by.caller) {
      const role = agent ? await agentRole(tx, by.caller, agent.id) : null;
      if (!agent || !canSeeCase(by.caller, role))
        throw new ApiError(404, "not_found", "No such agent.");
      if (!canWorkCase(role))
        throw new ApiError(
          403,
          "forbidden",
          "Starting a case needs operator access to the agent.",
        );
    }
    if (!agent) throw new ApiError(404, "not_found", "No such agent.");

    const [deployment] = await tx
      .select({
        id: deployments.id,
        layer: deployments.sandboxLayer,
        manifest: deployments.manifest,
        environment: deployments.environment,
      })
      .from(deployments)
      .where(
        and(
          eq(deployments.agentId, agent.id),
          eq(deployments.status, "ready"),
          input.deployment
            ? eq(deployments.id, input.deployment)
            : isNotNull(deployments.promotedAt),
        ),
      )
      .orderBy(desc(deployments.promotedAt))
      .limit(1);
    if (!deployment) {
      if (input.deployment)
        throw new ApiError(404, "not_found", "No such deployment.");
      throw new ApiError(
        409,
        "no_production_deployment",
        "This agent has no production deployment. Promote one, or name a deployment.",
      );
    }
    if (deployment.layer && !customEnvironments)
      throw new ApiError(
        409,
        "agent_paused",
        `${agent.slug} is paused because it uses a custom environment, which requires the Team plan. Upgrade to Team to resume automatically, or remove the custom setup in code.`,
      );

    await assertModelAllowed(
      tx,
      (await effectiveSettings(tx, agent.id, deployment.manifest as Manifest))
        .model,
    );
    await refuseOverLimit(tx);
    const caseId = newId("case");
    if (input.files.length) {
      const found = await tx
        .select({ id: files.id })
        .from(files)
        .where(and(inArray(files.id, input.files), isNull(files.caseId)));
      if (found.length !== new Set(input.files).size)
        throw new ApiError(404, "not_found", "No such file.");
    }
    const [row] = await tx
      .insert(cases)
      .values({
        id: caseId,
        organizationId: org,
        agentId: agent.id,
        deploymentId: deployment.id,
        status: "queued",
        source: by.source,
        createdBy: by.createdBy,
      })
      .returning({ createdAt: cases.createdAt });
    await meter(tx, env, {
      organizationId: org,
      feature: "cases",
      quantity: 1,
      caseId,
    });
    await meterCaseFee(tx, env, org, caseId, now);
    if (input.files.length)
      await tx
        .update(files)
        .set({ caseId })
        .where(inArray(files.id, input.files));
    await audit(tx, {
      organizationId: org,
      actorType: by.actorType,
      actorId: by.createdBy,
      action: "case.created",
      targetType: "case",
      targetId: caseId,
      caseId,
      requestId: by.requestId ?? null,
      ip: by.ip ?? null,
      data: {
        agentId: agent.id,
        deploymentId: deployment.id,
        source: by.source,
        files: input.files.length,
      },
    });
    const outboxId = await writeOutbox(tx, org, "case.start", {
      caseId,
      text: input.text ?? "",
    });
    const body: CaseAccepted = {
      id: caseId,
      status: "queued",
      statusUrl: statusUrl(env, org, caseId),
      createdAt: row!.createdAt.toISOString(),
    };
    if (idempotencyKey)
      await tx
        .update(idempotencyKeys)
        .set({ caseId, responseBody: body })
        .where(
          and(
            eq(idempotencyKeys.organizationId, org),
            eq(idempotencyKeys.operation, "cases.create"),
            eq(idempotencyKeys.key, idempotencyKey),
          ),
        );
    return {
      body,
      replayed: false as const,
      outboxId,
      agentId: agent.id,
      deploymentId: deployment.id,
      test: deployment.environment === "preview",
    };
  });
  if (!created.replayed) {
    await drainOutbox(env, org, [{ id: created.outboxId, kind: "case.start" }]);
    await trackEvent(
      env,
      "case_started",
      org,
      by.actorType === "person" ? by.createdBy : null,
      {
        case_id: created.body.id,
        agent_id: created.agentId,
        deployment_id: created.deploymentId,
        source: by.source,
        files: input.files.length,
        test: created.test,
      },
    );
  }
  return { body: created.body, replayed: created.replayed };
};

// The groups an agent can wait on and tag: those with a grant on it, and
// Developers.
export const agentGroups = async (
  tx: Tx,
  agentId: string,
): Promise<GroupRef[]> => {
  const rows = await tx
    .select({
      id: groups.id,
      slug: groups.slug,
      name: groups.name,
      description: groups.description,
      isDevelopers: groups.isDevelopers,
      access: agentGrants.access,
    })
    .from(groups)
    .leftJoin(
      agentGrants,
      and(eq(agentGrants.groupId, groups.id), eq(agentGrants.agentId, agentId)),
    )
    .where(or(isNotNull(agentGrants.access), eq(groups.isDevelopers, true)));
  return rows.map((g) => ({
    id: g.id,
    slug: g.slug,
    name: g.name,
    description: g.description,
    access: g.isDevelopers ? "developers" : g.access!,
  }));
};

// The CASES consumer: resolve the case's deployment, files and groups and
// start it in the runtime. The runtime's start is idempotent on the case id,
// so a repeated delivery is harmless.
export const startQueuedCase = async (env: Env, message: OutboxMessage) => {
  const row = await readOutbox(env, message);
  if (!row) return;
  const { caseId, text } = row.payload as { caseId: string; text: string };
  const start = await withOrg(env, orgId(row.organizationId), async (tx) => {
    const [found] = await tx
      .select({
        agentId: cases.agentId,
        status: cases.status,
        deploymentId: deployments.id,
        bundleSha256: deployments.bundleSha256,
        network: deployments.network,
        manifest: deployments.manifest,
      })
      .from(cases)
      .innerJoin(deployments, eq(deployments.id, cases.deploymentId))
      .where(eq(cases.id, caseId));
    if (!found || found.status === "cancelled") return null;
    const caseFiles = await tx
      .select({
        id: files.id,
        name: files.name,
        contentType: files.contentType,
      })
      .from(files)
      .where(eq(files.caseId, caseId));
    return {
      organizationId: row.organizationId,
      agentId: found.agentId,
      caseId,
      deploymentId: found.deploymentId,
      bundleHash: found.bundleSha256,
      network: found.network,
      settings: await effectiveSettings(
        tx,
        found.agentId,
        found.manifest as Manifest,
      ),
      input: { text, files: caseFiles },
      groups: await agentGroups(tx, found.agentId),
      memories: await acceptedMemories(tx, found.agentId),
    } satisfies StartCase;
  });
  if (!start) return;
  if (!env.RUNTIME) throw new Error("The runtime Worker is not bound.");
  await env.RUNTIME.startCase(start);
};

// An approval as the runtime keeps it (apps/runtime/src/approvals.ts).
export type Approval = {
  id: string;
  level: "completion" | "field" | "tool";
  target: string;
  group: string | null;
  payload: unknown;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "stale";
  run: number;
  requestedAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  note: string | null;
};

// What the runtime reports (apps/runtime/src/env.ts CaseEvent).
export type CaseEvent = {
  organizationId: string;
  agentId: string;
  caseId: string;
} & (
  | {
      type: "status";
      status:
        "running" | "waiting" | "halted" | "completed" | "failed" | "cancelled";
      waitingOn: string | null;
      reason: string | null;
      answers: Record<string, unknown> | null;
      error: { code: string; message: string } | null;
      haltReason?: "credit_exhausted" | "spending_limit_reached";
      // Everything the case has been charged so far (spec 16a), its parts,
      // and the size of its stored run capture. A runtime older than
      // metering sends none, which keeps what is stored.
      costMicroUsd?: number;
      charges?: Charges;
      captureBytes?: number;
      // Set when the case waits on an approval, whose own event sends the
      // webhook.
      approvalId?: string;
      // On completion or failure: what the run used (product analytics).
      stats?: CaseStats;
      completed?: {
        input: StartCase["input"];
        captureKey: string;
        // The agent's final message, for case search.
        answer?: string;
      };
    }
  | { type: "approval"; approval: Approval }
  | { type: "review"; fields: string[] }
  | {
      type: "mention";
      group: string;
      messageId: string;
      by: string;
      message: string;
    }
);

// apps/runtime/src/env.ts CaseStats.
export type CaseStats = {
  model: string;
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  modelErrors: number;
  ocrPages: number;
  mcp: { server: string; calls: number; errors: number }[];
};

const errorClass = (event: Extract<CaseEvent, { type: "status" }>) =>
  event.status !== "failed"
    ? ("none" as const)
    : event.error?.code === "timeout"
      ? ("timeout" as const)
      : event.stats?.modelErrors
        ? ("model_error" as const)
        : ("run_failed" as const);

const groupBySlug = async (tx: Tx, slug: string) => {
  const [group] = await tx
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.slug, slug));
  return group?.id ?? null;
};

// The one writer of the case index: status, the group a case waits on, and
// mentions for the inbox. Webhooks and notification emails it decides are
// queued in the same transaction and drained after it commits.
export const recordCaseEvent = async (env: Env, event: CaseEvent) => {
  const rows: { id: string; kind: OutboxKind }[] = [];
  let handedOffTo = null as string | null;
  let finished = false as boolean;
  let halted = false as boolean;
  let test = false as boolean;
  let requested = null as { level: Approval["level"]; group: boolean } | null;
  let durationMs = 0;
  let sandboxSeconds = 0;
  let mcpIds = new Map<string, string>();
  await withOrg(env, orgId(event.organizationId), async (tx) => {
    const own = and(
      eq(cases.id, event.caseId),
      eq(cases.agentId, event.agentId),
    );
    if (event.type === "approval") {
      const a = event.approval;
      const [known] = await tx.select({ id: cases.id }).from(cases).where(own);
      if (!known) return;
      const [group] = a.group
        ? await tx
            .select({ id: groups.id, slug: groups.slug, name: groups.name })
            .from(groups)
            .where(eq(groups.slug, a.group))
        : [];
      const [seen] = await tx
        .select({ id: caseApprovals.id })
        .from(caseApprovals)
        .where(eq(caseApprovals.id, a.id));
      const decided = {
        status: a.status,
        decidedBy: a.decidedBy,
        decidedAt: a.decidedAt === null ? null : new Date(a.decidedAt),
        note: a.note,
      };
      await tx
        .insert(caseApprovals)
        .values({
          id: a.id,
          organizationId: event.organizationId,
          caseId: event.caseId,
          level: a.level,
          target: a.target,
          groupId: group?.id ?? null,
          payload: a.payload,
          reason: a.reason,
          requestedAt: new Date(a.requestedAt),
          ...decided,
        })
        .onConflictDoUpdate({ target: caseApprovals.id, set: decided });
      // A new request notifies the group the code named, or any operator.
      if (a.status !== "pending" || a.decidedAt !== null) return;
      if (!seen) {
        requested = { level: a.level, group: a.group !== null };
        test = await onPreview(tx, event.caseId);
      }
      const webhookRows = await queueWebhooks(env, tx, event.organizationId, {
        caseId: event.caseId,
        agentId: event.agentId,
        status: "waiting",
        group: group ?? null,
        reason: a.reason,
        answers: null,
        error: null,
        approval: {
          id: a.id,
          level: a.level,
          target: a.target,
          payload: a.payload,
        },
      });
      for (const id of webhookRows) rows.push({ id, kind: "webhook" });
      return;
    }
    if (event.type === "review") {
      const [known] = await tx
        .select({ fields: cases.reviewFields, since: cases.reviewSince })
        .from(cases)
        .where(own);
      if (!known) return;
      const before = new Set(known.fields);
      const added = event.fields.some((f) => !before.has(f));
      if (!added && known.fields.length === event.fields.length) return;
      // The inbox item keeps its key (and read mark) while fields only get
      // reviewed; a newly unreviewed field makes it new again.
      await tx
        .update(cases)
        .set({
          reviewFields: event.fields,
          reviewSince: !event.fields.length
            ? null
            : added || !known.since
              ? new Date()
              : known.since,
        })
        .where(own);
      return;
    }
    if (event.type === "mention") {
      const groupId = await groupBySlug(tx, event.group);
      const [known] = await tx.select({ id: cases.id }).from(cases).where(own);
      if (!groupId || !known) return;
      const mentionId = newId("mention");
      await tx.insert(caseMentions).values({
        id: mentionId,
        organizationId: event.organizationId,
        caseId: event.caseId,
        groupId,
        messageId: event.messageId,
        by: event.by,
        message: event.message,
      });
      rows.push(
        await notifyLater(tx, event.organizationId, {
          type: "mention",
          mentionId,
        }),
      );
      return;
    }
    const group = event.waitingOn
      ? ((
          await tx
            .select({ id: groups.id, slug: groups.slug, name: groups.name })
            .from(groups)
            .where(eq(groups.slug, event.waitingOn))
        )[0] ?? null)
      : null;
    const [before] = await tx
      .select({
        status: cases.status,
        group: cases.waitingOnGroupId,
        since: cases.waitingSince,
        createdAt: cases.createdAt,
        environment: deployments.environment,
      })
      .from(cases)
      .innerJoin(deployments, eq(deployments.id, cases.deploymentId))
      .where(own);
    if (!before) return;
    test = before.environment === "preview";
    if (event.charges)
      await meterCharges(
        tx,
        env,
        event.organizationId,
        event.caseId,
        event.charges,
      );
    const now = new Date();
    const done = event.status === "completed" || event.status === "failed";
    // Every completed case joins its agent's automatic eval suite (doc 09).
    if (event.status === "completed" && event.completed)
      await joinAutomaticSuite(tx, event.organizationId, event.agentId, {
        caseId: event.caseId,
        input: event.completed.input,
        answers: event.answers,
        captureKey: event.completed.captureKey,
      });
    const newWait =
      event.status === "waiting" &&
      group !== null &&
      (before.status !== "waiting" || before.group !== group.id);
    if (newWait) handedOffTo = group.id;
    finished = done && before.status !== event.status;
    halted = event.status === "halted" && before.status !== "halted";
    if (finished) {
      durationMs = Math.max(0, now.getTime() - before.createdAt.getTime());
      const [used] = await tx
        .select({
          seconds: sql<string>`coalesce(sum(extract(epoch from coalesce(${sandboxIntervals.endedAt}, ${sandboxIntervals.lastSeenAt}) - ${sandboxIntervals.startedAt})), 0)`,
        })
        .from(sandboxIntervals)
        .where(eq(sandboxIntervals.caseId, event.caseId));
      sandboxSeconds = Math.round(Number(used?.seconds ?? 0));
      const slugs = event.stats?.mcp.map((m) => m.server) ?? [];
      if (slugs.length)
        mcpIds = new Map(
          (
            await tx
              .select({ id: mcpServers.id, slug: mcpServers.slug })
              .from(mcpServers)
              .where(inArray(mcpServers.slug, slugs))
          ).map((m) => [m.slug, m.id]),
        );
    }
    await tx
      .update(cases)
      .set({
        status: event.status,
        waitingOnGroupId: group?.id ?? null,
        waitingSince:
          event.status === "waiting" && group
            ? newWait
              ? now
              : before.since
            : null,
        haltReason:
          event.status === "halted" ? (event.haltReason ?? null) : null,
        ...(event.costMicroUsd !== undefined && {
          costMicroUsd: event.costMicroUsd,
        }),
        ...(event.captureBytes !== undefined && {
          captureBytes: event.captureBytes,
        }),
        updatedAt: now,
        completedAt: done ? now : null,
      })
      .where(own);
    if (event.status === "completed" && event.completed)
      await indexCase(tx, {
        organizationId: event.organizationId,
        caseId: event.caseId,
        input: event.completed.input,
        answer: event.completed.answer ?? null,
        answers: event.answers,
        completedAt: now,
      });
    if (newWait)
      rows.push(
        await notifyLater(tx, event.organizationId, {
          type: "waiting",
          caseId: event.caseId,
          groupId: group.id,
          since: now.toISOString(),
          reason: event.reason,
        }),
      );
    // Webhooks: completion, failure, and every wait on a new group.
    // Cancellation and halts send none.
    // A wait on an approval sends its own webhook from the approval event.
    if (!done && !(newWait && event.approvalId === undefined)) return;
    const webhookRows = await queueWebhooks(env, tx, event.organizationId, {
      caseId: event.caseId,
      agentId: event.agentId,
      status: event.status as "completed" | "failed" | "waiting",
      group,
      reason: event.reason,
      answers: event.answers,
      error: event.error,
    });
    for (const id of webhookRows) rows.push({ id, kind: "webhook" });
  });
  if (rows.length) await drainOutbox(env, orgId(event.organizationId), rows);
  const ids = { case_id: event.caseId, agent_id: event.agentId };
  if (requested)
    await trackEvent(env, "approval_requested", event.organizationId, null, {
      ...ids,
      ...requested,
      test,
    });
  if (event.type !== "status") return;
  if (finished) {
    const stats = event.stats;
    const credits = (event.costMicroUsd ?? 0) / MICRO_USD_PER_CREDIT;
    await trackEvent(env, "case_completed", event.organizationId, null, {
      ...ids,
      outcome: event.status as "completed",
      error_class: errorClass(event),
      duration_ms: durationMs,
      duration_bucket: durationBucket(durationMs),
      model: stats ? modelSlug(stats.model) : "unknown",
      tokens_in: stats?.tokensIn ?? 0,
      tokens_out: stats?.tokensOut ?? 0,
      credits: Math.round(credits),
      credits_bucket: amountBucket(credits),
      tool_calls: stats?.toolCalls ?? 0,
      mcp_calls: stats?.mcp.reduce((total, m) => total + m.calls, 0) ?? 0,
      sandbox_seconds: sandboxSeconds,
      ocr_pages: stats?.ocrPages ?? 0,
      test,
    });
    for (const m of stats?.mcp ?? []) {
      const server = mcpIds.get(m.server);
      if (server)
        await trackEvent(env, "mcp_tool_called", event.organizationId, null, {
          ...ids,
          mcp_server_id: server,
          calls: m.calls,
          errors: m.errors,
          test,
        });
    }
  }
  if (halted && event.haltReason)
    await trackEvent(env, "case_halted", event.organizationId, null, {
      ...ids,
      cause: event.haltReason,
      test,
    });
  if (handedOffTo)
    await trackEvent(env, "case_handed_off", event.organizationId, null, {
      ...ids,
      group_id: handedOffTo,
      approval: event.approvalId !== undefined,
      test,
    });
};

// Whether a case runs on a preview deployment: a test of unreleased code,
// which product analytics marks `test`.
export const onPreview = async (tx: Tx, caseId: string) => {
  const [row] = await tx
    .select({ environment: deployments.environment })
    .from(cases)
    .innerJoin(deployments, eq(deployments.id, cases.deploymentId))
    .where(eq(cases.id, caseId));
  return row?.environment === "preview";
};
