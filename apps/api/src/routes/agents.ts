import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import { agents } from "@preprocess/db/schema/access";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import {
  eventBase,
  requireAdmin,
  requireDeployer,
  type OrgVariables,
} from "../caller.ts";
import {
  deploy,
  deployInput,
  getDeployment,
  listDeployments,
  productionDeployment,
  promote,
} from "../deploy.ts";
import type { Env } from "../env.ts";

export const agentRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>();

const Deployment = z
  .object({
    id: z.string(),
    agentId: z.string(),
    status: z.enum(["ready", "waiting", "failed", "building"]).openapi({
      description:
        "building: the sandbox's custom environment is being built; the deployment settles to ready, waiting or failed",
    }),
    production: z.boolean(),
    waitingFor: z.object({
      secrets: z.array(z.string()).optional(),
      mcp: z.array(z.string()).optional(),
    }),
    sdkVersion: z.string(),
    model: z.string(),
    reasoning: z.string(),
    git: z.object({
      branch: z.string().nullable(),
      commit: z.string().nullable(),
    }),
    source: z.enum(["cli", "github"]),
    tools: z.array(z.string()),
    secrets: z.array(z.string()),
    warnings: z.array(z.string()).openapi({
      description:
        "Build warnings from the agent's code and preprocess.config.json",
    }),
    sandboxEnvironment: z
      .object({
        status: z.enum(["building", "ready", "failed"]),
        bytes: z.number().optional(),
        error: z.string().optional(),
        log: z.string().nullable().optional(),
      })
      .nullable()
      .openapi({
        description:
          "The sandbox's custom environment (sandbox.setup): its build, its size in bytes once built, or why the build failed",
      }),
    createdAt: z.string(),
    promotedAt: z.string().nullable(),
  })
  .openapi("Deployment");

const Agent = z
  .object({
    id: z.string(),
    slug: z.string(),
    productionBranch: z.string(),
    productionDeploymentId: z.string().nullable(),
    archived: z.boolean(),
  })
  .openapi("Agent");

const AgentParams = z.object({ org: z.string(), agent: z.string() });
const DeploymentParams = AgentParams.extend({ deployment: z.string() });

const agentBySlug = (env: Env, org: OrgVariables["org"], slug: string) =>
  withOrg(env, org, async (tx) => {
    const [agent] = await tx.select().from(agents).where(eq(agents.slug, slug));
    if (!agent) throw new HTTPException(404, { message: "agent not found" });
    return agent;
  });

const agentView = async (
  env: Env,
  org: OrgVariables["org"],
  agent: typeof agents.$inferSelect,
) => ({
  id: agent.id,
  slug: agent.slug,
  productionBranch: agent.productionBranch,
  productionDeploymentId:
    (await productionDeployment(env, org, agent.id))?.id ?? null,
  archived: agent.archivedAt !== null,
});

agentRoutes.openapi(
  createRoute({
    method: "get",
    path: "/agents",
    tags: ["Agents"],
    request: { params: z.object({ org: z.string() }) },
    responses: {
      200: {
        description: "The organization's agents",
        content: { "application/json": { schema: z.array(Agent) } },
      },
    },
  }),
  async (c) => {
    const rows = await withOrg(c.env, c.var.org, (tx) =>
      tx.select().from(agents).orderBy(agents.slug),
    );
    return c.json(
      await Promise.all(rows.map((a) => agentView(c.env, c.var.org, a))),
      200,
    );
  },
);

agentRoutes.openapi(
  createRoute({
    method: "get",
    path: "/agents/{agent}",
    tags: ["Agents"],
    request: { params: AgentParams },
    responses: {
      200: {
        description: "One agent",
        content: { "application/json": { schema: Agent } },
      },
    },
  }),
  async (c) => {
    const agent = await agentBySlug(
      c.env,
      c.var.org,
      c.req.valid("param").agent,
    );
    return c.json(await agentView(c.env, c.var.org, agent), 200);
  },
);

agentRoutes.openapi(
  createRoute({
    method: "post",
    path: "/agents/{agent}/deployments",
    tags: ["Agents"],
    summary:
      "Deploy an agent's bundled code; creates the agent on its first deploy (Owners, Admins and Developers)",
    request: {
      params: AgentParams,
      body: {
        content: { "application/json": { schema: deployInput } },
        required: true,
      },
    },
    responses: {
      201: {
        description: "The new deployment",
        content: { "application/json": { schema: Deployment } },
      },
    },
  }),
  async (c) => {
    await requireDeployer(c.env, c.var, "deploy", c.req.valid("param").agent);
    const deployment = await deploy(
      c.env,
      c.var.org,
      c.req.valid("param").agent,
      {
        ...c.req.valid("json"),
        source:
          c.req.header("x-preprocess-source") === "github" ? "github" : "cli",
      },
      eventBase(c.var),
    );
    return c.json(deployment, 201);
  },
);

agentRoutes.openapi(
  createRoute({
    method: "get",
    path: "/agents/{agent}/deployments",
    tags: ["Agents"],
    request: { params: AgentParams },
    responses: {
      200: {
        description: "Newest first",
        content: { "application/json": { schema: z.array(Deployment) } },
      },
    },
  }),
  async (c) => {
    const agent = await agentBySlug(
      c.env,
      c.var.org,
      c.req.valid("param").agent,
    );
    return c.json(await listDeployments(c.env, c.var.org, agent.id), 200);
  },
);

agentRoutes.openapi(
  createRoute({
    method: "get",
    path: "/agents/{agent}/deployments/{deployment}",
    tags: ["Agents"],
    request: { params: DeploymentParams },
    responses: {
      200: {
        description: "One deployment",
        content: { "application/json": { schema: Deployment } },
      },
    },
  }),
  async (c) => {
    const { agent: slug, deployment } = c.req.valid("param");
    const agent = await agentBySlug(c.env, c.var.org, slug);
    return c.json(
      await getDeployment(c.env, c.var.org, agent.id, deployment),
      200,
    );
  },
);

agentRoutes.openapi(
  createRoute({
    method: "post",
    path: "/agents/{agent}/deployments/{deployment}/promote",
    tags: ["Agents"],
    summary:
      "Serve this deployment in production; promoting an earlier one is a rollback (Owners, Admins and Developers)",
    request: { params: DeploymentParams },
    responses: {
      200: {
        description: "The promoted deployment",
        content: { "application/json": { schema: Deployment } },
      },
    },
  }),
  async (c) => {
    const { agent: slug, deployment } = c.req.valid("param");
    await requireDeployer(c.env, c.var, "promote", slug);
    const agent = await agentBySlug(c.env, c.var.org, slug);
    const cleared = await promote(
      c.env,
      c.var.org,
      agent.id,
      deployment,
      eventBase(c.var),
    );
    const promoted = await getDeployment(
      c.env,
      c.var.org,
      agent.id,
      deployment,
    );
    return c.json(
      { ...promoted, warnings: [...promoted.warnings, ...cleared] },
      200,
    );
  },
);

agentRoutes.openapi(
  createRoute({
    method: "post",
    path: "/agents/{agent}/archive",
    tags: ["Agents"],
    request: { params: AgentParams },
    responses: {
      200: {
        description: "The archived agent",
        content: { "application/json": { schema: Agent } },
      },
    },
  }),
  async (c) => {
    requireAdmin(c.var.caller);
    const agent = await agentBySlug(
      c.env,
      c.var.org,
      c.req.valid("param").agent,
    );
    const archived = await withOrg(c.env, c.var.org, async (tx) => {
      const [row] = await tx
        .update(agents)
        .set({ archivedAt: new Date() })
        .where(eq(agents.id, agent.id))
        .returning();
      await audit(tx, {
        ...eventBase(c.var),
        action: "agent.archived",
        targetType: "agent",
        targetId: agent.id,
      });
      return row!;
    });
    return c.json(await agentView(c.env, c.var.org, archived), 200);
  },
);
