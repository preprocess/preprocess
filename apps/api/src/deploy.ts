// Deploys and secret delivery (spec 4, design doc 03). A deploy uploads the
// agent's bundle as its own Workers for Platforms script, reads what the code
// declares, binds the secrets the agent is granted, records the deployment,
// and promotes it when it came from the production branch. Secret values are
// decrypted only here, in memory, and go only to the agent's script.

import type { OrgId, Tx } from "@preprocess/db/client";
import { withOrg } from "@preprocess/db/client";
import { audit } from "@preprocess/db/audit";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import {
  deployments,
  secretDeliveries,
  secretGrants,
  type WaitingFor,
} from "@preprocess/db/schema/deployments";
import { mcpGrants, mcpServers } from "@preprocess/db/schema/mcp";
import { secrets } from "@preprocess/db/schema/secrets";
import { MODELS, PROTOCOL, REASONING } from "@preprocess/sdk/protocol";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { AuditInput } from "@preprocess/db/audit";
import { decrypt, orgKeyVersion } from "./crypto.ts";
import type { Env } from "./env.ts";
import { namespaceFor } from "./namespace.ts";

type Actor = Pick<AuditInput, "actorType" | "actorId" | "ip" | "requestId">;

const manifestSchema = z.object({
  protocol: z.literal(PROTOCOL),
  sdk: z.object({ name: z.literal("@preprocess/sdk"), version: z.string() }),
  instructions: z.string(),
  model: z.enum(MODELS),
  reasoning: z.enum(REASONING),
  secrets: z.array(z.string()),
  mcp: z.array(z.string()),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      inputSchema: z.record(z.string(), z.unknown()),
      sideEffects: z.boolean(),
    }),
  ),
});

export type Manifest = z.infer<typeof manifestSchema>;

// Network rules are an organization guardrail set in step 5; until then
// agent code may reach any host.
export const NETWORK = { allow: [] as string[], block: [] as string[] };

export const deploymentTarget = (d: {
  organizationId: string;
  agentId: string;
  id: string;
  scriptName: string;
}) => ({
  organizationId: d.organizationId,
  agentId: d.agentId,
  deploymentId: d.id,
  script: d.scriptName,
  network: NETWORK,
});

const sha256 = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

type Binding = {
  secretId: string;
  name: string;
  version: number;
  value: string;
};

// Bound set = declared ∩ granted (doc 03), with current values.
const boundSecrets = async (
  env: Env,
  tx: Tx,
  organizationId: string,
  agentId: string,
  declared: string[],
): Promise<{ bound: Binding[]; waiting: string[] }> => {
  if (declared.length === 0) return { bound: [], waiting: [] };
  const rows = await tx
    .select({
      secretId: secrets.id,
      name: secrets.name,
      version: secrets.version,
      keyVersion: secrets.keyVersion,
      ciphertext: secrets.ciphertext,
    })
    .from(secretGrants)
    .innerJoin(secrets, eq(secrets.id, secretGrants.secretId))
    .where(
      and(eq(secretGrants.agentId, agentId), inArray(secrets.name, declared)),
    );
  const bound: Binding[] = [];
  for (const row of rows) {
    const key = await orgKeyVersion(env, tx, organizationId, row.keyVersion);
    bound.push({
      secretId: row.secretId,
      name: row.name,
      version: row.version,
      value: await decrypt(
        key,
        row.ciphertext,
        `${organizationId}|${row.secretId}|${row.version}`,
      ),
    });
  }
  const granted = new Set(bound.map((b) => b.name));
  return { bound, waiting: declared.filter((name) => !granted.has(name)) };
};

// Brings one deployment's script in line with current grants and values:
// sets new or changed values, removes revoked ones, records deliveries and
// audits each (spec 12: which deployment received a secret). Returns what
// it still waits for.
export const syncDeployment = async (
  env: Env,
  org: OrgId,
  deploymentId: string,
  actor: Actor,
): Promise<string[]> => {
  const { deployment, bound, waiting, waitingMcp, delivered } = await withOrg(
    env,
    org,
    async (tx) => {
      const [deployment] = await tx
        .select()
        .from(deployments)
        .where(eq(deployments.id, deploymentId));
      if (!deployment)
        throw new HTTPException(404, { message: "deployment not found" });
      const declared = (deployment.manifest as Manifest).secrets;
      const delivered = await tx
        .select({
          secretId: secretDeliveries.secretId,
          version: secretDeliveries.secretVersion,
          name: secrets.name,
        })
        .from(secretDeliveries)
        .innerJoin(secrets, eq(secrets.id, secretDeliveries.secretId))
        .where(eq(secretDeliveries.deploymentId, deploymentId));
      const declaredMcp = (deployment.manifest as Manifest).mcp;
      const granted = declaredMcp.length
        ? await tx
            .select({ slug: mcpServers.slug })
            .from(mcpGrants)
            .innerJoin(mcpServers, eq(mcpServers.id, mcpGrants.serverId))
            .where(eq(mcpGrants.agentId, deployment.agentId))
        : [];
      return {
        deployment,
        delivered,
        waitingMcp: declaredMcp.filter(
          (slug) => !granted.some((g) => g.slug === slug),
        ),
        ...(await boundSecrets(env, tx, org, deployment.agentId, declared)),
      };
    },
  );
  const namespace = namespaceFor(env);
  const current = new Map(delivered.map((d) => [d.secretId, d.version]));
  const changed = bound.filter((b) => current.get(b.secretId) !== b.version);
  const removed = delivered.filter(
    (d) => !bound.some((b) => b.secretId === d.secretId),
  );
  for (const b of changed)
    await namespace.putSecret(deployment.scriptName, {
      name: b.name,
      text: b.value,
    });
  for (const d of removed)
    await namespace.deleteSecret(deployment.scriptName, d.name);
  await withOrg(env, org, async (tx) => {
    for (const b of changed) {
      await tx
        .insert(secretDeliveries)
        .values({
          organizationId: org,
          deploymentId,
          secretId: b.secretId,
          secretVersion: b.version,
        })
        .onConflictDoUpdate({
          target: [secretDeliveries.deploymentId, secretDeliveries.secretId],
          set: { secretVersion: b.version, deliveredAt: sql`now()` },
        });
      await audit(tx, {
        organizationId: org,
        ...actor,
        action: "secret.delivered",
        targetType: "secret",
        targetId: b.secretId,
        data: { secret: b.name, version: b.version, deployment: deploymentId },
      });
    }
    for (const d of removed) {
      await tx
        .delete(secretDeliveries)
        .where(
          and(
            eq(secretDeliveries.deploymentId, deploymentId),
            eq(secretDeliveries.secretId, d.secretId),
          ),
        );
      await audit(tx, {
        organizationId: org,
        ...actor,
        action: "secret.withdrawn",
        targetType: "secret",
        targetId: d.secretId,
        data: { secret: d.name, deployment: deploymentId },
      });
    }
    const status =
      deployment.status === "failed"
        ? "failed"
        : waiting.length || waitingMcp.length
          ? "waiting"
          : "ready";
    const waitingFor: WaitingFor = {
      ...(waiting.length && { secrets: waiting }),
      ...(waitingMcp.length && { mcp: waitingMcp }),
    };
    await tx
      .update(deployments)
      .set({ status, waitingFor })
      .where(eq(deployments.id, deploymentId));
  });
  return [...waiting, ...waitingMcp.map((slug) => `MCP server ${slug}`)];
};

// Live scripts (doc 03): the production deployment and the newest deployment
// of every other branch. Older ones are resynced when promoted again.
export const liveDeployments = (tx: Tx, agentId: string) =>
  tx
    .select({ id: deployments.id })
    .from(deployments)
    .where(
      and(
        eq(deployments.agentId, agentId),
        sql`(${deployments.id} = (
          select d.id from deployments d where d.agent_id = ${agentId} and d.promoted_at is not null
          order by d.promoted_at desc limit 1)
        or ${deployments.id} in (
          select distinct on (coalesce(d.git_branch, '')) d.id from deployments d
          where d.agent_id = ${agentId} order by coalesce(d.git_branch, ''), d.created_at desc))`,
      ),
    );

export const syncAgent = async (
  env: Env,
  org: OrgId,
  agentId: string,
  actor: Actor,
) => {
  const live = await withOrg(env, org, (tx) => liveDeployments(tx, agentId));
  for (const d of live) await syncDeployment(env, org, d.id, actor);
};

export const AGENT_SLUG = /^[a-z][a-z0-9-]{0,62}$/;

export const deployInput = z.object({
  bundle: z.object({
    mainModule: z.string().min(1),
    modules: z
      .record(z.string(), z.string())
      .refine((m) => Object.keys(m).length > 0, "no modules"),
  }),
  git: z
    .object({
      branch: z.string().min(1).optional(),
      commit: z.string().min(1).optional(),
    })
    .default({}),
});

export type DeployInput = z.infer<typeof deployInput> & {
  source: "cli" | "github";
};

export const deploy = async (
  env: Env,
  org: OrgId,
  slug: string,
  input: DeployInput,
  actor: Actor,
) => {
  if (!AGENT_SLUG.test(slug))
    throw new HTTPException(400, {
      message: `agent name must match ${AGENT_SLUG}`,
    });
  if (!(input.bundle.mainModule in input.bundle.modules))
    throw new HTTPException(400, {
      message: "mainModule is not among the modules",
    });
  // Agents are created by their first deploy, never in the app (mvp-surface).
  const agent = await withOrg(env, org, async (tx) => {
    const [created] = await tx
      .insert(agents)
      .values({ id: newId("agent"), organizationId: org, slug })
      .onConflictDoNothing()
      .returning();
    if (created)
      await audit(tx, {
        organizationId: org,
        ...actor,
        action: "agent.created",
        targetType: "agent",
        targetId: created.id,
        data: { slug },
      });
    const [agent] = await tx.select().from(agents).where(eq(agents.slug, slug));
    return agent!;
  });
  if (agent.archivedAt)
    throw new HTTPException(409, { message: "agent is archived" });

  const id = newId("deployment");
  const target = { organizationId: org, agentId: agent.id, id, scriptName: id };
  await namespaceFor(env).putScript(id, {
    mainModule: input.bundle.mainModule,
    modules: input.bundle.modules,
    bindings: [],
    tags: [`org:${org}`, `agent:${agent.id}`],
  });
  const read = manifestSchema.safeParse(
    await env.RUNTIME.manifest(deploymentTarget(target)).catch(
      (error: unknown) => {
        throw new HTTPException(422, {
          message: `the agent's Worker did not serve its manifest: ${String(error)}`,
        });
      },
    ),
  );
  if (!read.success)
    throw new HTTPException(422, {
      message: `the agent's manifest is invalid: ${z.prettifyError(read.error)}`,
    });
  const manifest = read.data;

  await withOrg(env, org, async (tx) => {
    await tx.insert(deployments).values({
      id,
      organizationId: org,
      agentId: agent.id,
      status: "ready",
      scriptName: id,
      bundleSha256: await sha256(JSON.stringify(input.bundle)),
      sdkVersion: manifest.sdk.version,
      environment:
        input.git.branch === agent.productionBranch ? "production" : "preview",
      manifest,
      gitBranch: input.git.branch ?? null,
      gitCommit: input.git.commit ?? null,
      source: input.source,
      createdBy: actor.actorId,
    });
    await audit(tx, {
      organizationId: org,
      ...actor,
      action: "deployment.created",
      targetType: "deployment",
      targetId: id,
      data: {
        agent: agent.id,
        branch: input.git.branch ?? null,
        commit: input.git.commit ?? null,
        sdkVersion: manifest.sdk.version,
        source: input.source,
      },
    });
  });
  const waiting = await syncDeployment(env, org, id, actor);
  if (waiting.length === 0 && input.git.branch === agent.productionBranch)
    await promote(env, org, agent.id, id, actor);
  return getDeployment(env, org, agent.id, id);
};

export const promote = async (
  env: Env,
  org: OrgId,
  agentId: string,
  deploymentId: string,
  actor: Actor,
) => {
  const [target] = await withOrg(env, org, (tx) =>
    tx
      .select({ environment: deployments.environment })
      .from(deployments)
      .where(
        and(eq(deployments.id, deploymentId), eq(deployments.agentId, agentId)),
      ),
  );
  if (!target)
    throw new HTTPException(404, { message: "deployment not found" });
  if (target.environment !== "production")
    throw new HTTPException(409, {
      message: "only a deployment from the production branch can be promoted",
    });
  // An older deployment never brings back a revoked grant or an old value.
  const waiting = await syncDeployment(env, org, deploymentId, actor);
  if (waiting.length)
    throw new HTTPException(409, {
      message: `deployment is waiting for grants: ${waiting.join(", ")}`,
    });
  await withOrg(env, org, async (tx) => {
    const [row] = await tx
      .update(deployments)
      .set({ promotedAt: sql`now()` })
      .where(
        and(eq(deployments.id, deploymentId), eq(deployments.agentId, agentId)),
      )
      .returning({ id: deployments.id });
    if (!row) throw new HTTPException(404, { message: "deployment not found" });
    await audit(tx, {
      organizationId: org,
      ...actor,
      action: "deployment.promoted",
      targetType: "deployment",
      targetId: deploymentId,
      data: { agent: agentId },
    });
  });
};

const view = (
  d: typeof deployments.$inferSelect,
  production: string | undefined,
) => ({
  id: d.id,
  agentId: d.agentId,
  status: d.status,
  production: d.id === production,
  waitingFor: d.waitingFor,
  sdkVersion: d.sdkVersion,
  environment: d.environment,
  model: (d.manifest as Manifest).model,
  reasoning: (d.manifest as Manifest).reasoning,
  git: { branch: d.gitBranch, commit: d.gitCommit },
  source: d.source,
  tools: (d.manifest as Manifest).tools.map((t) => t.name),
  secrets: (d.manifest as Manifest).secrets,
  createdAt: d.createdAt.toISOString(),
  promotedAt: d.promotedAt?.toISOString() ?? null,
});

export type DeploymentView = ReturnType<typeof view>;

const productionId = async (tx: Tx, agentId: string) =>
  (
    await tx
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.agentId, agentId),
          isNotNull(deployments.promotedAt),
        ),
      )
      .orderBy(desc(deployments.promotedAt))
      .limit(1)
  )[0]?.id;

export const getDeployment = (
  env: Env,
  org: OrgId,
  agentId: string,
  id: string,
) =>
  withOrg(env, org, async (tx) => {
    const [d] = await tx
      .select()
      .from(deployments)
      .where(and(eq(deployments.id, id), eq(deployments.agentId, agentId)));
    if (!d) throw new HTTPException(404, { message: "deployment not found" });
    return view(d, await productionId(tx, agentId));
  });

export const listDeployments = (env: Env, org: OrgId, agentId: string) =>
  withOrg(env, org, async (tx) => {
    const production = await productionId(tx, agentId);
    const rows = await tx
      .select()
      .from(deployments)
      .where(eq(deployments.agentId, agentId))
      .orderBy(desc(deployments.createdAt))
      .limit(100);
    return rows.map((d) => view(d, production));
  });

export const productionDeployment = (env: Env, org: OrgId, agentId: string) =>
  withOrg(env, org, async (tx) => {
    const id = await productionId(tx, agentId);
    if (!id) return null;
    const [d] = await tx
      .select()
      .from(deployments)
      .where(eq(deployments.id, id));
    return d ?? null;
  });
