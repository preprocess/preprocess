// The organization's sandboxes at a glance (spec 3): which agents declare a
// sandbox in code, with the preset, size, package count and custom
// environment of their production deployment, plus the largest size the
// guardrail allows. Read-only: every value here is set in code or under
// Guardrails.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { withOrg } from "@preprocess/db/client";
import { agents } from "@preprocess/db/schema/access";
import { deployments } from "@preprocess/db/schema/deployments";
import {
  SANDBOX_PRESETS,
  SANDBOX_SIZES,
  type SandboxManifest,
} from "@preprocess/sdk/protocol";
import { and, desc, eq, isNull } from "drizzle-orm";

import type { OrgVariables } from "../caller.ts";
import type { Env } from "../env.ts";
import { customImagesAllowed } from "../plan.ts";
import { LARGE_LAYER_BYTES } from "../sandbox-layers.ts";
import { caseSandboxSizes, sandboxMaxSize, sandboxSizes } from "../sandbox.ts";

const Environment = z
  .discriminatedUnion("status", [
    z.object({ status: z.literal("building") }),
    z.object({
      status: z.literal("ready"),
      bytes: z.number(),
      large: z.boolean().openapi({
        description: "Large enough to slow every sandbox start and wake",
      }),
    }),
    z.object({
      status: z.literal("failed"),
      deploymentId: z.string().openapi({
        description: "The deployment whose build failed, for its build log",
      }),
      serving: z.boolean().openapi({
        description: "An earlier production deployment keeps serving",
      }),
    }),
  ])
  .nullable()
  .openapi("SandboxEnvironment", {
    description:
      "The custom environment (sandbox.setup): the latest deployment's build while it builds or after it failed, else the production deployment's layer; null without one",
  });

const SandboxAgent = z
  .object({
    id: z.string(),
    slug: z.string(),
    path: z.string().nullable().openapi({
      description:
        "The agent's entry file relative to the repository root; null when the deploy did not send it",
    }),
    preset: z.enum(SANDBOX_PRESETS),
    size: z.enum(SANDBOX_SIZES),
    packages: z.number().int().openapi({
      description: "apt, pip and npm packages in sandbox.packages",
    }),
    waiting: z.boolean().openapi({
      description:
        "The latest deployment asks for a size above the guardrail and waits for approval",
    }),
    paused: z.boolean().openapi({
      description:
        "Production runs in a custom environment the plan lacks, so the agent takes no new cases",
    }),
    environment: Environment,
  })
  .openapi("SandboxAgent");

const Sandboxes = z
  .object({
    maxSize: z.enum(SANDBOX_SIZES).nullable().openapi({
      description:
        "The largest size the guardrail allows; null allows every size",
    }),
    customEnvironments: z.boolean().openapi({
      description: "Whether the plan includes custom environments",
    }),
    sizes: z.array(
      z.object({
        size: z.enum(SANDBOX_SIZES),
        vcpu: z.number(),
        memoryGib: z.number(),
        diskGb: z.number(),
      }),
    ),
    agents: z.array(SandboxAgent),
  })
  .openapi("Sandboxes");

type Deployment = typeof deployments.$inferSelect;

const manifestOf = (d: Deployment | undefined) =>
  d?.manifest as { sandbox?: SandboxManifest; entry?: string } | undefined;

// One agent's row from its production deployments, newest first.
const agentSandbox = (history: Deployment[], customEnvironments: boolean) => {
  const production = history
    .filter((d) => d.promotedAt)
    .sort((a, b) => b.promotedAt!.getTime() - a.promotedAt!.getTime())[0];
  const latest = history[0];
  const pending =
    latest &&
    latest.id !== production?.id &&
    (!production || latest.createdAt > production.createdAt)
      ? latest
      : undefined;
  const waiting =
    pending?.status === "waiting" && Boolean(pending.waitingFor.sandboxSize);
  const building = pending?.sandboxLayer?.status === "building";
  const manifest = manifestOf(
    waiting || building || !production ? pending : production,
  );
  const sandbox = manifest?.sandbox;
  if (!sandbox) return null;
  const layer =
    building || pending?.sandboxLayer?.status === "failed"
      ? pending?.sandboxLayer
      : production?.sandboxLayer;
  const environment =
    layer?.status === "ready"
      ? {
          status: "ready" as const,
          bytes: layer.bytes,
          large: layer.bytes > LARGE_LAYER_BYTES,
        }
      : layer?.status === "failed"
        ? {
            status: "failed" as const,
            deploymentId: pending!.id,
            serving: Boolean(production),
          }
        : layer?.status === "building"
          ? { status: "building" as const }
          : null;
  const { apt, pip, npm } = sandbox.packages;
  return {
    path: manifest.entry ?? null,
    preset: sandbox.preset,
    size: sandbox.size,
    packages: apt.length + pip.length + npm.length,
    waiting,
    paused: !customEnvironments && Boolean(production?.sandboxLayer),
    environment,
  };
};

export const sandboxRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>().openapi(
  createRoute({
    method: "get",
    path: "/sandboxes",
    tags: ["Sandboxes"],
    summary:
      "Agents that declare a sandbox, the sizes on offer and the largest one the guardrail allows",
    request: { params: z.object({ org: z.string() }) },
    responses: {
      200: {
        description: "The organization's sandboxes",
        content: { "application/json": { schema: Sandboxes } },
      },
    },
  }),
  async (c) => {
    const customEnvironments = await customImagesAllowed(c.env, c.var.org);
    const { maxSize, rows } = await withOrg(c.env, c.var.org, async (tx) => ({
      maxSize: await sandboxMaxSize(tx),
      rows: await tx
        .select({ agent: agents, deployment: deployments })
        .from(deployments)
        .innerJoin(agents, eq(agents.id, deployments.agentId))
        .where(
          and(
            isNull(agents.archivedAt),
            eq(deployments.environment, "production"),
          ),
        )
        .orderBy(agents.slug, desc(deployments.createdAt)),
    }));
    const byAgent = new Map<string, { slug: string; history: Deployment[] }>();
    for (const { agent, deployment } of rows) {
      const entry = byAgent.get(agent.id) ?? { slug: agent.slug, history: [] };
      entry.history.push(deployment);
      byAgent.set(agent.id, entry);
    }
    return c.json(
      {
        maxSize,
        customEnvironments,
        sizes: SANDBOX_SIZES.map((size) => {
          const { vcpu, memoryGib, diskGb } =
            sandboxSizes[caseSandboxSizes[size]];
          return { size, vcpu, memoryGib, diskGb };
        }),
        agents: [...byAgent].flatMap(([id, { slug, history }]) => {
          const sandbox = agentSandbox(history, customEnvironments);
          return sandbox ? [{ id, slug, ...sandbox }] : [];
        }),
      },
      200,
    );
  },
);
