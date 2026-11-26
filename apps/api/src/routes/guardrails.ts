// Organization guardrails (spec 5, mvp-surface "Organization defaults and
// guardrails"): the network rules, per-agent rules that only narrow them, and
// loosening requests. An Owner or Admin changes a guardrail directly, and that
// change is the approval; anyone in Developers, and a deployment that asks for
// more than a guardrail allows, files a request for an Owner or Admin.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { secretGrants } from "@preprocess/db/schema/deployments";
import {
  agentNetworkRules,
  guardrailRequests,
  organizationGuardrails,
} from "@preprocess/db/schema/guardrails";
import type { GuardrailChange } from "@preprocess/db/schema/guardrails";
import { mcpGrants, mcpServers } from "@preprocess/db/schema/mcp";
import { secrets } from "@preprocess/db/schema/secrets";
import { MODELS, SANDBOX_SIZES } from "@preprocess/sdk/protocol";
import { desc, eq } from "drizzle-orm";

import { allowedModels, setAllowedModels } from "../allowed-models.ts";
import { actor, eventBase, requireAdmin, requireDeveloper } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import { syncAgents } from "../deploy.ts";
import type { Env } from "../env.ts";
import {
  agentNetwork,
  effectiveNetwork,
  loosens,
  NETWORK_PATTERN,
  narrow,
  opening,
  organizationNetwork,
  permits,
} from "../network.ts";
import type { NetworkRules } from "../network.ts";
import { sandboxMaxSize, setSandboxMaxSize, sizeAllowed } from "../sandbox.ts";
import { setSpendingLimit, toMicro } from "./spending.ts";

const OrgParam = z.object({ org: z.string() });
const AgentParam = OrgParam.extend({ agent: z.string() });
const RequestParam = OrgParam.extend({ id: z.string() });

const Pattern = z
  .string()
  .transform((p) => p.trim().toLowerCase())
  .refine((p) => NETWORK_PATTERN.test(p), {
    message: 'a host like "api.example.com" or "*.example.com"',
  });

const Rules = z
  .object({
    allow: z.array(Pattern).max(200),
    block: z.array(Pattern).max(200),
  })
  .openapi("NetworkRules", {
    description:
      "A host passes when no block pattern matches it and the allow list is empty or one of its patterns matches",
  });

const AgentRules = z
  .object({
    organization: Rules,
    agent: Rules.nullable().openapi({
      description:
        "The agent's own rules, which only narrow the organization's",
    }),
    effective: Rules,
  })
  .openapi("AgentNetworkRules");

const SandboxMaxSize = z
  .enum(SANDBOX_SIZES)
  .nullable()
  .openapi("SandboxMaxSize", {
    description:
      "The largest case sandbox an agent may use; null allows every size",
  });

const AllowedModels = z
  .array(z.enum(MODELS))
  .min(1)
  .nullable()
  .openapi("AllowedModels", {
    description:
      "The catalogue models agents may run on; null allows every model. Deploys, settings, case starts, reruns, approvals and eval runs that resolve to another model are refused with model_not_allowed (409).",
  });

export const Change = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("network"), hosts: z.array(Pattern).min(1) }),
    z.object({ kind: z.literal("secret"), secret: z.string() }),
    z.object({ kind: z.literal("mcp"), server: z.string() }),
    z.object({
      kind: z.literal("spending_limit"),
      limitUsd: z.number().nonnegative().max(1e9).nullable(),
    }),
    z.object({ kind: z.literal("sandbox_size"), size: z.enum(SANDBOX_SIZES) }),
  ])
  .openapi("GuardrailChange");

const GuardrailRequest = z
  .object({
    id: z.string(),
    agent: z.string().nullable(),
    deployment: z.string().nullable(),
    change: Change,
    reason: z.string().nullable(),
    status: z.enum(["pending", "approved", "rejected"]),
    requestedBy: z.object({ type: z.string(), id: z.string() }),
    decidedBy: z.string().nullable(),
    decidedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("GuardrailRequest");

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const findAgent = async (tx: Tx, slug: string) => {
  const [agent] = await tx
    .select({ id: agents.id, slug: agents.slug })
    .from(agents)
    .where(eq(agents.slug, slug));
  if (!agent) throw new ApiError(404, "not_found", "No such agent.");
  return agent;
};

const allAgents = async (tx: Tx) =>
  (await tx.select({ id: agents.id }).from(agents)).map((a) => a.id);

const setOrganizationNetwork = async (
  tx: Tx,
  vars: OrgVariables,
  next: NetworkRules,
) => {
  const before = await organizationNetwork(tx);
  const updatedBy = actor(vars.caller).actorId;
  await tx
    .insert(organizationGuardrails)
    .values({ organizationId: vars.org, network: next, updatedBy })
    .onConflictDoUpdate({
      target: organizationGuardrails.organizationId,
      set: { network: next, updatedBy, updatedAt: new Date() },
    });
  await audit(tx, {
    ...eventBase(vars),
    action: "guardrail.updated",
    targetType: "organization",
    targetId: vars.org,
    data: {
      guardrail: "network",
      loosened: loosens(before, next),
      before,
      after: next,
    },
  });
  return allAgents(tx);
};

const setAgentNetwork = async (
  tx: Tx,
  vars: OrgVariables,
  agentId: string,
  next: NetworkRules | null,
) => {
  const organization = await organizationNetwork(tx);
  const own = await agentNetwork(tx, agentId);
  const before = narrow(organization, own);
  const after = narrow(organization, next ?? undefined);
  if (next)
    await tx
      .insert(agentNetworkRules)
      .values({
        organizationId: vars.org,
        agentId,
        rules: next,
        updatedBy: actor(vars.caller).actorId,
      })
      .onConflictDoUpdate({
        target: [agentNetworkRules.organizationId, agentNetworkRules.agentId],
        set: {
          rules: next,
          updatedBy: actor(vars.caller).actorId,
          updatedAt: new Date(),
        },
      });
  else
    await tx
      .delete(agentNetworkRules)
      .where(eq(agentNetworkRules.agentId, agentId));
  await audit(tx, {
    ...eventBase(vars),
    action: "guardrail.updated",
    targetType: "agent",
    targetId: agentId,
    data: {
      guardrail: "network",
      agent: agentId,
      loosened: loosens(before, after),
      before: own ?? null,
      after: next,
    },
  });
  return [agentId];
};

// Applies an approved change as the approving Owner or Admin and returns the
// agents whose live deployments must be resynced.
const applyChange = async (
  tx: Tx,
  vars: OrgVariables,
  agentId: string | null,
  change: GuardrailChange,
): Promise<string[]> => {
  switch (change.kind) {
    case "network": {
      const organization = await organizationNetwork(tx);
      const synced: string[] = [];
      if (!change.hosts.every((h) => permits(organization, h)))
        synced.push(
          ...(await setOrganizationNetwork(
            tx,
            vars,
            opening(organization, change.hosts),
          )),
        );
      const own = agentId ? await agentNetwork(tx, agentId) : undefined;
      if (agentId && own)
        synced.push(
          ...(await setAgentNetwork(
            tx,
            vars,
            agentId,
            opening(own, change.hosts),
          )),
        );
      return [...new Set(synced)];
    }
    case "secret": {
      const [secret] = await tx
        .select({ id: secrets.id })
        .from(secrets)
        .where(eq(secrets.name, change.secret));
      if (!secret || !agentId)
        throw new ApiError(404, "not_found", "No such secret or agent.");
      await tx
        .insert(secretGrants)
        .values({
          organizationId: vars.org,
          secretId: secret.id,
          agentId,
          grantedBy: actor(vars.caller).actorId,
        })
        .onConflictDoNothing();
      await audit(tx, {
        ...eventBase(vars),
        action: "secret.granted",
        targetType: "secret",
        targetId: secret.id,
        data: { secret: change.secret, agent: agentId },
      });
      return [agentId];
    }
    case "mcp": {
      const [server] = await tx
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(eq(mcpServers.slug, change.server));
      if (!server || !agentId)
        throw new ApiError(404, "not_found", "No such MCP server or agent.");
      await tx
        .insert(mcpGrants)
        .values({
          organizationId: vars.org,
          serverId: server.id,
          agentId,
          grantedBy: actor(vars.caller).actorId,
        })
        .onConflictDoNothing();
      await audit(tx, {
        ...eventBase(vars),
        action: "mcp.granted",
        targetType: "mcp_server",
        targetId: server.id,
        data: { server: change.server, agent: agentId },
      });
      return [agentId];
    }
    case "spending_limit":
      await setSpendingLimit(
        tx,
        vars,
        change.limitUsd === null ? null : toMicro(change.limitUsd),
      );
      return [];
    case "sandbox_size": {
      if (sizeAllowed(await sandboxMaxSize(tx), change.size)) return [];
      await setSandboxMaxSize(tx, vars, change.size);
      return allAgents(tx);
    }
  }
};

type RequestRow = typeof guardrailRequests.$inferSelect & {
  agentSlug: string | null;
};

const toRequest = (r: RequestRow) => ({
  id: r.id,
  agent: r.agentSlug,
  deployment: r.deploymentId,
  change: r.change,
  reason: r.reason,
  status: r.status,
  requestedBy: { type: r.requestedByType, id: r.requestedBy },
  decidedBy: r.decidedBy,
  decidedAt: r.decidedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

const requestRows = (tx: Tx) =>
  tx
    .select({
      id: guardrailRequests.id,
      organizationId: guardrailRequests.organizationId,
      kind: guardrailRequests.kind,
      agentId: guardrailRequests.agentId,
      deploymentId: guardrailRequests.deploymentId,
      change: guardrailRequests.change,
      reason: guardrailRequests.reason,
      status: guardrailRequests.status,
      requestedByType: guardrailRequests.requestedByType,
      requestedBy: guardrailRequests.requestedBy,
      decidedBy: guardrailRequests.decidedBy,
      decidedAt: guardrailRequests.decidedAt,
      createdAt: guardrailRequests.createdAt,
      agentSlug: agents.slug,
    })
    .from(guardrailRequests)
    .leftJoin(agents, eq(agents.id, guardrailRequests.agentId));

const decide = async (
  env: Env,
  vars: OrgVariables,
  id: string,
  approve: boolean,
) => {
  requireAdmin(vars.caller);
  const body = await withOrg(env, vars.org, async (tx) => {
    const [request] = await requestRows(tx).where(eq(guardrailRequests.id, id));
    if (!request) throw new ApiError(404, "not_found", "No such request.");
    if (request.status !== "pending")
      throw new ApiError(
        409,
        "request_decided",
        `The request was already ${request.status}.`,
      );
    const decidedAt = new Date();
    const decidedBy = actor(vars.caller).actorId;
    const status = approve ? "approved" : "rejected";
    // Decided first, so the sync below doesn't withdraw it as no longer needed.
    await tx
      .update(guardrailRequests)
      .set({ status, decidedBy, decidedAt })
      .where(eq(guardrailRequests.id, id));
    if (approve)
      await syncAgents(
        tx,
        vars.org,
        await applyChange(tx, vars, request.agentId, request.change),
      );
    await audit(tx, {
      ...eventBase(vars),
      action: approve
        ? "guardrail.request.approved"
        : "guardrail.request.rejected",
      targetType: "guardrail_request",
      targetId: id,
      data: { change: request.change, agent: request.agentId },
    });
    return toRequest({ ...request, status, decidedBy, decidedAt });
  });
  return body;
};

export const guardrailRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/guardrails",
      tags: ["Guardrails"],
      summary:
        "The organization's network rules, largest sandbox size, allowed models and model endpoints",
      request: { params: OrgParam },
      responses: {
        200: json(
          z.object({
            network: Rules,
            sandboxMaxSize: SandboxMaxSize,
            allowedModels: AllowedModels,
            modelEndpoints: z.literal("hosted").openapi({
              description:
                "Hosted service only; self-hosted endpoints arrive with build step 9",
            }),
          }),
          "Guardrails",
        ),
      },
    }),
    async (c) => {
      const { network, sandboxSize, models } = await withOrg(
        c.env,
        c.var.org,
        async (tx) => ({
          network: await organizationNetwork(tx),
          sandboxSize: await sandboxMaxSize(tx),
          models: await allowedModels(tx),
        }),
      );
      return c.json(
        {
          network,
          sandboxMaxSize: sandboxSize,
          allowedModels: models,
          modelEndpoints: "hosted" as const,
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/guardrails/sandbox-size",
      tags: ["Guardrails"],
      summary:
        "Set the largest case sandbox an agent may use (Owner or Admin; raising it is approved by making the change)",
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({ size: SandboxMaxSize }),
            },
          },
        },
      },
      responses: {
        200: json(z.object({ size: SandboxMaxSize }), "The new largest size"),
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const { size } = c.req.valid("json");
      await withOrg(c.env, c.var.org, async (tx) => {
        if (await setSandboxMaxSize(tx, c.var, size))
          await syncAgents(tx, c.var.org, await allAgents(tx));
      });
      return c.json({ size }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/guardrails/allowed-models",
      tags: ["Guardrails"],
      summary:
        "Set the models agents may run on (Owner or Admin); null allows every model",
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({ models: AllowedModels }),
            },
          },
        },
      },
      responses: {
        200: json(z.object({ models: AllowedModels }), "The allowed models"),
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const { models } = c.req.valid("json");
      const saved = await withOrg(c.env, c.var.org, async (tx) => {
        await setAllowedModels(tx, c.var, models);
        return allowedModels(tx);
      });
      return c.json({ models: saved }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/guardrails/network",
      tags: ["Guardrails"],
      summary:
        "Replace the organization's network rules (Owner or Admin; loosening them is approved by making the change)",
      request: {
        params: OrgParam,
        body: { content: { "application/json": { schema: Rules } } },
      },
      responses: { 200: json(Rules, "The new rules") },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const rules = c.req.valid("json");
      await withOrg(c.env, c.var.org, async (tx) =>
        syncAgents(
          tx,
          c.var.org,
          await setOrganizationNetwork(tx, c.var, rules),
        ),
      );
      return c.json(rules, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/agents/{agent}/network",
      tags: ["Guardrails"],
      summary: "An agent's network rules and the rules its deployments apply",
      request: { params: AgentParam },
      responses: { 200: json(AgentRules, "Rules") },
    }),
    async (c) =>
      c.json(
        await withOrg(c.env, c.var.org, async (tx) => {
          const agent = await findAgent(tx, c.req.valid("param").agent);
          const own = await agentNetwork(tx, agent.id);
          return {
            organization: await organizationNetwork(tx),
            agent: own ?? null,
            effective: await effectiveNetwork(tx, agent.id),
          };
        }),
        200,
      ),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/agents/{agent}/network",
      tags: ["Guardrails"],
      summary:
        "Set an agent's network rules, which only narrow the organization's (Owner or Admin)",
      request: {
        params: AgentParam,
        body: { content: { "application/json": { schema: Rules } } },
      },
      responses: { 200: json(AgentRules, "Rules") },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const rules = c.req.valid("json");
      const body = await withOrg(c.env, c.var.org, async (tx) => {
        const agent = await findAgent(tx, c.req.valid("param").agent);
        await syncAgents(
          tx,
          c.var.org,
          await setAgentNetwork(tx, c.var, agent.id, rules),
        );
        return {
          organization: await organizationNetwork(tx),
          agent: rules,
          effective: await effectiveNetwork(tx, agent.id),
        };
      });
      return c.json(body, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/agents/{agent}/network",
      tags: ["Guardrails"],
      summary:
        "Remove an agent's own network rules so the organization's apply (Owner or Admin)",
      request: { params: AgentParam },
      responses: { 204: { description: "Removed" } },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      await withOrg(c.env, c.var.org, async (tx) => {
        const agent = await findAgent(tx, c.req.valid("param").agent);
        await syncAgents(
          tx,
          c.var.org,
          await setAgentNetwork(tx, c.var, agent.id, null),
        );
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/guardrail-requests",
      tags: ["Guardrails"],
      summary: "Requests to loosen a guardrail, newest first",
      request: {
        params: OrgParam,
        query: z.object({
          status: z.enum(["pending", "approved", "rejected"]).optional(),
        }),
      },
      responses: { 200: json(z.array(GuardrailRequest), "Requests") },
    }),
    async (c) => {
      const { status } = c.req.valid("query");
      const rows = await withOrg(c.env, c.var.org, (tx) =>
        requestRows(tx)
          .where(status ? eq(guardrailRequests.status, status) : undefined)
          .orderBy(desc(guardrailRequests.createdAt)),
      );
      return c.json(rows.map(toRequest), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/guardrail-requests",
      tags: ["Guardrails"],
      summary:
        "Ask an Owner or Admin to loosen a guardrail (Owners, Admins, and the Developers group)",
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                agent: z.string().optional(),
                change: Change,
                reason: z.string().max(2000).optional(),
              }),
            },
          },
        },
      },
      responses: { 201: json(GuardrailRequest, "The pending request") },
    }),
    async (c) => {
      const { agent: slug, change, reason } = c.req.valid("json");
      const caller = c.var.caller;
      const body = await withOrg(c.env, c.var.org, async (tx) => {
        await requireDeveloper(tx, caller);
        const agent = slug ? await findAgent(tx, slug) : null;
        if (!agent && (change.kind === "secret" || change.kind === "mcp"))
          throw new ApiError(
            400,
            "agent_required",
            "Name the agent the grant is for.",
          );
        const { actorType, actorId } = actor(caller);
        const [row] = await tx
          .insert(guardrailRequests)
          .values({
            id: newId("guardrailRequest"),
            organizationId: c.var.org,
            kind: change.kind,
            agentId: agent?.id ?? null,
            change,
            reason: reason ?? null,
            requestedByType: actorType,
            requestedBy: actorId,
          })
          .returning();
        await audit(tx, {
          ...eventBase(c.var),
          action: "guardrail.request.created",
          targetType: "guardrail_request",
          targetId: row!.id,
          data: { change, agent: agent?.id ?? null },
        });
        return toRequest({ ...row!, agentSlug: agent?.slug ?? null });
      });
      return c.json(body, 201);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/guardrail-requests/{id}/approve",
      tags: ["Guardrails"],
      summary: "Approve a request and apply its change (Owner or Admin)",
      request: { params: RequestParam },
      responses: { 200: json(GuardrailRequest, "The approved request") },
    }),
    async (c) =>
      c.json(await decide(c.env, c.var, c.req.valid("param").id, true), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/guardrail-requests/{id}/reject",
      tags: ["Guardrails"],
      summary: "Reject a request (Owner or Admin)",
      request: { params: RequestParam },
      responses: { 200: json(GuardrailRequest, "The rejected request") },
    }),
    async (c) =>
      c.json(await decide(c.env, c.var, c.req.valid("param").id, false), 200),
  );
