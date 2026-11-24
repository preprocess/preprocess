// Outbound webhook endpoints and their delivery log (design doc 06). Owners,
// Admins and API keys manage them; the signing secret is shown once.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import {
  webhookDeliveries,
  webhookEndpoints,
  webhookEvents,
} from "@preprocess/db/schema/webhooks";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";

import { eventBase, requireAdmin } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import type { Env } from "../env.ts";
import { drainOutbox, writeOutbox } from "../outbox.ts";
import { newSigningSecret, refusedHost, sealSecret } from "../webhooks.ts";

type Ctx = Context<{ Bindings: Env; Variables: OrgVariables }>;

const OrgParam = z.object({ org: z.string() });
const EndpointParam = OrgParam.extend({ id: z.string() });
const DeliveryParam = EndpointParam.extend({ msgId: z.string() });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});

const Url = z
  .string()
  .url()
  .refine((u) => {
    const url = new URL(u);
    return url.protocol === "https:" && !refusedHost(url);
  }, "must be a public https URL");
const Events = z.array(z.enum(webhookEvents)).min(1);

const Endpoint = z
  .object({
    id: z.string(),
    url: z.string(),
    events: z.array(z.string()),
    agentIds: z.array(z.string()).nullable(),
    enabled: z.boolean(),
    disabledReason: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("WebhookEndpoint");

const Delivery = z
  .object({
    id: z.string(),
    eventType: z.string(),
    caseId: z.string(),
    status: z.enum(["pending", "delivered", "failed"]),
    attempts: z.number(),
    lastStatusCode: z.number().nullable(),
    lastError: z.string().nullable(),
    nextAttemptAt: z.string().nullable(),
    deliveredAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("WebhookDelivery");

const toEndpoint = (e: typeof webhookEndpoints.$inferSelect) => ({
  id: e.id,
  url: e.url,
  events: e.events,
  agentIds: e.agentIds,
  enabled: e.enabled,
  disabledReason: e.disabledReason,
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
});

const findEndpoint = async (tx: Tx, id: string) => {
  const [found] = await tx
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.id, id));
  if (!found) throw new ApiError(404, "not_found", "No such webhook endpoint.");
  return found;
};

const checkAgents = async (tx: Tx, agentIds: string[] | null | undefined) => {
  if (!agentIds?.length) return;
  const found = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(inArray(agents.id, agentIds));
  if (found.length !== new Set(agentIds).size)
    throw new ApiError(404, "not_found", "No such agent.");
};

const admin = (c: Ctx) => requireAdmin(c.var.caller);

export const webhookRoutes = new OpenAPIHono<{
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
      path: "/webhooks",
      tags: ["Webhooks"],
      request: { params: OrgParam },
      responses: { 200: json(z.array(Endpoint), "The endpoints") },
    }),
    async (c) => {
      admin(c);
      const rows = await withOrg(c.env, c.var.org, (tx) =>
        tx.select().from(webhookEndpoints).orderBy(webhookEndpoints.createdAt),
      );
      return c.json(rows.map(toEndpoint), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/webhooks",
      tags: ["Webhooks"],
      summary: "Add an endpoint; the signing secret is returned only here",
      request: {
        params: OrgParam,
        ...body(
          z.object({
            url: Url,
            events: Events,
            agentIds: z.array(z.string()).min(1).nullable().default(null),
          }),
        ),
      },
      responses: {
        201: json(
          Endpoint.extend({ signingSecret: z.string() }),
          "Created, with its signing secret",
        ),
      },
    }),
    async (c) => {
      admin(c);
      const input = c.req.valid("json");
      const id = newId("webhook");
      const secret = newSigningSecret();
      const created = await withOrg(c.env, c.var.org, async (tx) => {
        await checkAgents(tx, input.agentIds);
        const [row] = await tx
          .insert(webhookEndpoints)
          .values({
            id,
            organizationId: c.var.org,
            url: input.url,
            events: input.events,
            agentIds: input.agentIds,
            ...(await sealSecret(c.env, tx, c.var.org, id, secret)),
            createdBy:
              c.var.caller.type === "person"
                ? c.var.caller.userId
                : c.var.caller.keyId,
          })
          .returning();
        await audit(tx, {
          ...eventBase(c.var),
          action: "webhook.created",
          targetType: "webhook",
          targetId: id,
          data: { url: input.url, events: input.events },
        });
        return row!;
      });
      return c.json({ ...toEndpoint(created), signingSecret: secret }, 201);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/webhooks/{id}",
      tags: ["Webhooks"],
      request: { params: EndpointParam },
      responses: { 200: json(Endpoint, "The endpoint") },
    }),
    async (c) => {
      admin(c);
      const row = await withOrg(c.env, c.var.org, (tx) =>
        findEndpoint(tx, c.req.valid("param").id),
      );
      return c.json(toEndpoint(row), 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/webhooks/{id}",
      tags: ["Webhooks"],
      summary: "Change an endpoint; enabling it again clears why it stopped",
      request: {
        params: EndpointParam,
        ...body(
          z.object({
            url: Url.optional(),
            events: Events.optional(),
            agentIds: z.array(z.string()).min(1).nullable().optional(),
            enabled: z.boolean().optional(),
          }),
        ),
      },
      responses: { 200: json(Endpoint, "Changed") },
    }),
    async (c) => {
      admin(c);
      const id = c.req.valid("param").id;
      const input = c.req.valid("json");
      const row = await withOrg(c.env, c.var.org, async (tx) => {
        await findEndpoint(tx, id);
        await checkAgents(tx, input.agentIds);
        const [updated] = await tx
          .update(webhookEndpoints)
          .set({
            ...(input.url !== undefined && { url: input.url }),
            ...(input.events !== undefined && { events: input.events }),
            ...(input.agentIds !== undefined && { agentIds: input.agentIds }),
            ...(input.enabled !== undefined && {
              enabled: input.enabled,
              disabledReason: null,
            }),
            updatedAt: new Date(),
          })
          .where(eq(webhookEndpoints.id, id))
          .returning();
        await audit(tx, {
          ...eventBase(c.var),
          action: "webhook.updated",
          targetType: "webhook",
          targetId: id,
          data: {
            ...(input.url !== undefined && { url: input.url }),
            ...(input.events !== undefined && { events: input.events }),
            ...(input.agentIds !== undefined && { agentIds: input.agentIds }),
            ...(input.enabled !== undefined && { enabled: input.enabled }),
          },
        });
        return updated!;
      });
      return c.json(toEndpoint(row), 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/webhooks/{id}",
      tags: ["Webhooks"],
      request: { params: EndpointParam },
      responses: { 204: { description: "Deleted, with its delivery log" } },
    }),
    async (c) => {
      admin(c);
      const id = c.req.valid("param").id;
      await withOrg(c.env, c.var.org, async (tx) => {
        const row = await findEndpoint(tx, id);
        await tx.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id));
        await audit(tx, {
          ...eventBase(c.var),
          action: "webhook.deleted",
          targetType: "webhook",
          targetId: id,
          data: { url: row.url },
        });
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/webhooks/{id}/rotate-secret",
      tags: ["Webhooks"],
      summary:
        "Replace the signing secret; the old one also signs for 24 hours",
      request: { params: EndpointParam },
      responses: {
        200: json(
          z.object({
            signingSecret: z.string(),
            previousExpiresAt: z.string(),
          }),
          "The new secret, shown once",
        ),
      },
    }),
    async (c) => {
      admin(c);
      const id = c.req.valid("param").id;
      const secret = newSigningSecret();
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await withOrg(c.env, c.var.org, async (tx) => {
        const row = await findEndpoint(tx, id);
        await tx
          .update(webhookEndpoints)
          .set({
            ...(await sealSecret(c.env, tx, c.var.org, id, secret)),
            previousSigningSecret: row.signingSecret,
            previousKeyVersion: row.keyVersion,
            previousExpiresAt: expires,
            updatedAt: new Date(),
          })
          .where(eq(webhookEndpoints.id, id));
        await audit(tx, {
          ...eventBase(c.var),
          action: "webhook.secret_rotated",
          targetType: "webhook",
          targetId: id,
        });
      });
      return c.json(
        { signingSecret: secret, previousExpiresAt: expires.toISOString() },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/webhooks/{id}/deliveries",
      tags: ["Webhooks"],
      summary: "The newest 100 deliveries",
      request: { params: EndpointParam },
      responses: { 200: json(z.array(Delivery), "Deliveries, newest first") },
    }),
    async (c) => {
      admin(c);
      const id = c.req.valid("param").id;
      const rows = await withOrg(c.env, c.var.org, async (tx) => {
        await findEndpoint(tx, id);
        return tx
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.endpointId, id))
          .orderBy(desc(webhookDeliveries.createdAt))
          .limit(100);
      });
      return c.json(
        rows.map((d) => ({
          id: d.id,
          eventType: d.eventType,
          caseId: d.caseId,
          status: d.status,
          attempts: d.attempts,
          lastStatusCode: d.lastStatusCode,
          lastError: d.lastError,
          nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
          deliveredAt: d.deliveredAt?.toISOString() ?? null,
          createdAt: d.createdAt.toISOString(),
        })),
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/webhooks/{id}/deliveries/{msgId}/redeliver",
      tags: ["Webhooks"],
      summary: "Send a delivery again, with the same webhook-id",
      request: { params: DeliveryParam },
      responses: { 202: { description: "Queued" } },
    }),
    async (c) => {
      admin(c);
      const { id, msgId } = c.req.valid("param");
      const outboxId = await withOrg(c.env, c.var.org, async (tx) => {
        const [found] = await tx
          .select({ id: webhookDeliveries.id })
          .from(webhookDeliveries)
          .where(
            and(
              eq(webhookDeliveries.id, msgId),
              eq(webhookDeliveries.endpointId, id),
            ),
          );
        if (!found) throw new ApiError(404, "not_found", "No such delivery.");
        await tx
          .update(webhookDeliveries)
          .set({ status: "pending", nextAttemptAt: new Date() })
          .where(eq(webhookDeliveries.id, msgId));
        return writeOutbox(tx, c.var.org, "webhook", { deliveryId: msgId });
      });
      await drainOutbox(c.env, c.var.org, [{ id: outboxId, kind: "webhook" }]);
      return c.body(null, 202);
    },
  );
