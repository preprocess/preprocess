// Organization secrets (mvp-surface "Secrets and models", design docs 01 and
// 03). Values are write-only; which agents' code receives each one is a
// guardrail only an Admin or Owner loosens.

import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import {
  deployments,
  secretDeliveries,
  secretGrants,
} from "@preprocess/db/schema/deployments";
import { secrets } from "@preprocess/db/schema/secrets";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  RESERVED_BINDINGS,
  RESERVED_PREFIX,
  SECRET_NAME,
} from "@preprocess/sdk/protocol";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import {
  actor,
  eventBase,
  requireAdmin,
  type OrgVariables,
} from "../caller.ts";
import { encrypt, orgKey } from "../crypto.ts";
import { liveDeployments } from "../deploy.ts";
import type { Env } from "../env.ts";

export const secretRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>();

const Secret = z
  .object({
    name: z.string(),
    version: z.number(),
    updatedAt: z.string(),
    agents: z
      .array(z.string())
      .openapi({ description: "Slugs of the agents granted this secret" }),
    delivered: z
      .number()
      .openapi({ description: "Live deployments holding the current version" }),
    live: z
      .number()
      .openapi({ description: "Live deployments the secret is bound to" }),
  })
  .openapi("Secret");

const SecretParams = z.object({ org: z.string(), name: z.string() });
const GrantParams = SecretParams.extend({ agent: z.string() });

const checkName = (name: string) => {
  if (
    !SECRET_NAME.test(name) ||
    (RESERVED_BINDINGS as readonly string[]).includes(name) ||
    name.startsWith(RESERVED_PREFIX)
  )
    throw new HTTPException(400, {
      message: `secret names match ${SECRET_NAME} and avoid MCP, MODELS and PREPROCESS_*`,
    });
};

const enqueue = (env: Env, organizationId: string, agentIds: string[]) =>
  agentIds.length
    ? env.SECRET_SYNC.sendBatch(
        agentIds.map((agentId) => ({
          body: { kind: "secret.sync" as const, organizationId, agentId },
        })),
      )
    : Promise.resolve();

secretRoutes.openapi(
  createRoute({
    method: "get",
    path: "/secrets",
    request: { params: z.object({ org: z.string() }) },
    responses: {
      200: {
        description: "Names and delivery status; never values",
        content: { "application/json": { schema: z.array(Secret) } },
      },
    },
  }),
  async (c) => {
    requireAdmin(c.var.caller);
    const list = await withOrg(c.env, c.var.org, async (tx) => {
      const rows = await tx.select().from(secrets).orderBy(secrets.name);
      const grants = await tx
        .select({
          secretId: secretGrants.secretId,
          agentId: agents.id,
          slug: agents.slug,
        })
        .from(secretGrants)
        .innerJoin(agents, eq(agents.id, secretGrants.agentId));
      const held = await tx
        .select({
          secretId: secretDeliveries.secretId,
          secretVersion: secretDeliveries.secretVersion,
          deploymentId: secretDeliveries.deploymentId,
          agentId: deployments.agentId,
        })
        .from(secretDeliveries)
        .innerJoin(
          deployments,
          eq(deployments.id, secretDeliveries.deploymentId),
        );
      const live = new Set<string>();
      for (const agentId of new Set(held.map((h) => h.agentId)))
        for (const d of await liveDeployments(tx, agentId)) live.add(d.id);
      const deliveries = held.filter((h) => live.has(h.deploymentId));
      return rows.map((s) => {
        const bound = deliveries.filter((d) => d.secretId === s.id);
        return {
          name: s.name,
          version: s.version,
          updatedAt: s.updatedAt.toISOString(),
          agents: grants.filter((g) => g.secretId === s.id).map((g) => g.slug),
          delivered: bound.filter((d) => d.secretVersion === s.version).length,
          live: bound.length,
        };
      });
    });
    return c.json(list, 200);
  },
);

secretRoutes.openapi(
  createRoute({
    method: "put",
    path: "/secrets/{name}",
    summary:
      "Create or replace a secret's value; live deployments that hold it are resynced",
    request: {
      params: SecretParams,
      body: {
        content: {
          "application/json": {
            schema: z.object({ value: z.string().min(1).max(5120) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The secret's new version",
        content: {
          "application/json": {
            schema: z.object({ name: z.string(), version: z.number() }),
          },
        },
      },
    },
  }),
  async (c) => {
    requireAdmin(c.var.caller);
    const { name } = c.req.valid("param");
    checkName(name);
    const { value } = c.req.valid("json");
    const result = await withOrg(c.env, c.var.org, async (tx) => {
      const { version: keyVersion, key } = await orgKey(c.env, tx, c.var.org);
      const [existing] = await tx
        .select()
        .from(secrets)
        .where(eq(secrets.name, name))
        .for("update");
      const id = existing?.id ?? newId("secret");
      const version = (existing?.version ?? 0) + 1;
      const ciphertext = await encrypt(
        key,
        value,
        `${c.var.org}|${id}|${version}`,
      );
      await tx
        .insert(secrets)
        .values({
          id,
          organizationId: c.var.org,
          name,
          version,
          keyVersion,
          ciphertext,
          updatedBy: actor(c.var.caller).actorId,
        })
        .onConflictDoUpdate({
          target: secrets.id,
          set: {
            version,
            keyVersion,
            ciphertext,
            updatedBy: actor(c.var.caller).actorId,
            updatedAt: new Date(),
          },
        });
      await audit(tx, {
        ...eventBase(c.var),
        action: existing ? "secret.updated" : "secret.created",
        targetType: "secret",
        targetId: id,
        data: { secret: name, version },
      });
      const granted = await tx
        .select({ agentId: secretGrants.agentId })
        .from(secretGrants)
        .where(eq(secretGrants.secretId, id));
      return { version, agentIds: granted.map((g) => g.agentId) };
    });
    await enqueue(c.env, c.var.org, result.agentIds);
    return c.json({ name, version: result.version }, 200);
  },
);

secretRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/secrets/{name}",
    summary: "Delete a secret; refused while a live deployment holds it",
    request: { params: SecretParams },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    requireAdmin(c.var.caller);
    const { name } = c.req.valid("param");
    await withOrg(c.env, c.var.org, async (tx) => {
      const [secret] = await tx
        .select()
        .from(secrets)
        .where(eq(secrets.name, name))
        .for("update");
      if (!secret)
        throw new HTTPException(404, { message: "secret not found" });
      const holders = await tx
        .select({
          deploymentId: secretDeliveries.deploymentId,
          agentId: deployments.agentId,
        })
        .from(secretDeliveries)
        .innerJoin(
          deployments,
          eq(deployments.id, secretDeliveries.deploymentId),
        )
        .where(eq(secretDeliveries.secretId, secret.id));
      const live: string[] = [];
      for (const agentId of new Set(holders.map((h) => h.agentId))) {
        const ids = new Set(
          (await liveDeployments(tx, agentId)).map((d) => d.id),
        );
        live.push(
          ...holders
            .filter((h) => ids.has(h.deploymentId))
            .map((h) => h.deploymentId),
        );
      }
      if (live.length)
        throw new HTTPException(409, {
          message: `live deployments hold this secret: ${live.join(", ")}`,
        });
      await tx.delete(secrets).where(eq(secrets.id, secret.id));
      await audit(tx, {
        ...eventBase(c.var),
        action: "secret.deleted",
        targetType: "secret",
        targetId: secret.id,
        data: { secret: name },
      });
    });
    return c.body(null, 204);
  },
);

const grantChange =
  (grant: boolean) =>
  async (c: Parameters<Parameters<typeof secretRoutes.openapi>[1]>[0]) => {
    requireAdmin(c.var.caller);
    const { name, agent: slug } = c.req.param() as z.infer<typeof GrantParams>;
    const agentId = await withOrg(c.env, c.var.org, async (tx) => {
      const [secret] = await tx
        .select()
        .from(secrets)
        .where(eq(secrets.name, name));
      const [agent] = await tx
        .select()
        .from(agents)
        .where(eq(agents.slug, slug));
      if (!secret || !agent)
        throw new HTTPException(404, { message: "secret or agent not found" });
      if (grant)
        await tx
          .insert(secretGrants)
          .values({
            organizationId: c.var.org,
            secretId: secret.id,
            agentId: agent.id,
            grantedBy: actor(c.var.caller).actorId,
          })
          .onConflictDoNothing();
      else
        await tx
          .delete(secretGrants)
          .where(
            and(
              eq(secretGrants.secretId, secret.id),
              eq(secretGrants.agentId, agent.id),
            ),
          );
      await audit(tx, {
        ...eventBase(c.var),
        action: grant ? "secret.granted" : "secret.revoked",
        targetType: "secret",
        targetId: secret.id,
        data: { secret: name, agent: agent.id },
      });
      return agent.id;
    });
    await enqueue(c.env, c.var.org, [agentId]);
    return c.body(null, 204);
  };

secretRoutes.openapi(
  createRoute({
    method: "put",
    path: "/secrets/{name}/agents/{agent}",
    summary:
      "Let an agent's code receive this secret (loosens a guardrail; Admin or Owner)",
    request: { params: GrantParams },
    responses: {
      204: { description: "Granted; live deployments are resynced" },
    },
  }),
  grantChange(true),
);

secretRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/secrets/{name}/agents/{agent}",
    summary:
      "Stop an agent's code receiving this secret; bindings are removed from live deployments",
    request: { params: GrantParams },
    responses: { 204: { description: "Revoked" } },
  }),
  grantChange(false),
);
