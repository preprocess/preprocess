// Deploys and secret delivery (spec 4, design doc 03). A deploy stores the
// agent's bundle for the runtime to load as a Dynamic Worker, reads what the
// code declares, records the deployment and what it waits for, and promotes it
// when it came from the production branch. Secret values are decrypted only
// here, in memory, when the runtime loads the code, and go only to it.

import type { OrgId, Tx } from "@preprocess/db/client";
import { orgId, withOrg } from "@preprocess/db/client";
import { audit } from "@preprocess/db/audit";
import { newId } from "@preprocess/db/ids";
import { agentGrants, agents, groups } from "@preprocess/db/schema/access";
import {
  deploymentGroups,
  deployments,
  secretGrants,
  type WaitingFor,
} from "@preprocess/db/schema/deployments";
import {
  guardrailRequests,
  type GuardrailChange,
} from "@preprocess/db/schema/guardrails";
import { auditEvents } from "@preprocess/db/schema/audit";
import { githubBuilds, githubLinks } from "@preprocess/db/schema/github";
import { mcpGrants, mcpServers } from "@preprocess/db/schema/mcp";
import { secrets } from "@preprocess/db/schema/secrets";
import {
  currentModel,
  MODELS,
  PROTOCOL,
  REASONING,
  sandboxManifest,
  sandboxProblems,
  type SandboxManifest,
} from "@preprocess/sdk/protocol";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { AuditInput } from "@preprocess/db/audit";
import { assertModelAllowed } from "./allowed-models.ts";
import { decrypt, orgKeyVersion } from "./crypto.ts";
import { startPushRuns } from "./evals.ts";
import type { Env } from "./env.ts";
import { markSeat } from "./metering.ts";
import { effectiveNetwork, permits } from "./network.ts";
import { grantViewersNewAgent } from "./plan-change.ts";
import { customImagesAllowed } from "./plan.ts";
import { sandboxMaxSize, sizeAllowed } from "./sandbox.ts";
import { layerBuilt } from "./sandbox-layers.ts";
import { nextFire, schedulerName } from "./scheduler.ts";
import {
  agentOverrideValues,
  clearOverrides,
  effectiveSettings,
  overrideWarnings,
} from "./settings.ts";
import type { NetworkRules } from "./network.ts";

type Actor = Pick<AuditInput, "actorType" | "actorId" | "ip" | "requestId">;

// Whose developer seat a deploy or promotion uses (spec 16a): the person who
// did it, the creator of the API key that did it, or, for a GitHub App
// build, the member who linked the repository. Null when there is none.
export const deploySeatHolder = async (
  tx: Tx,
  actor: Actor,
): Promise<string | null> => {
  if (actor.actorType === "person") return actor.actorId;
  if (actor.actorType === "api_key") {
    const [created] = await tx
      .select({ by: auditEvents.actorId })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "api_key.created"),
          eq(auditEvents.targetId, actor.actorId),
          eq(auditEvents.actorType, "person"),
        ),
      )
      .limit(1);
    return created?.by ?? null;
  }
  const build = actor.actorId.match(/^github:(.+)$/)?.[1];
  if (actor.actorType !== "platform" || !build) return null;
  const [linked] = await tx
    .select({ by: githubLinks.createdBy })
    .from(githubBuilds)
    .innerJoin(githubLinks, eq(githubLinks.id, githubBuilds.linkId))
    .where(eq(githubBuilds.id, build));
  return linked?.by ?? null;
};

const markDeveloper = async (tx: Tx, env: Env, org: string, actor: Actor) => {
  const userId = await deploySeatHolder(tx, actor);
  if (userId)
    await markSeat(tx, env, { organizationId: org, userId, role: "developer" });
};

const approvalRule = z.object({
  group: z.string().nullable(),
  conditional: z.boolean(),
});

const manifestSchema = z
  .object({
    protocol: z.literal(PROTOCOL),
    sdk: z.object({ name: z.literal("@preprocess/sdk"), version: z.string() }),
    instructions: z.string(),
    model: z.string().transform(currentModel).pipe(z.enum(MODELS)),
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
    // Optional in protocol 1; kept so settings can tell the code's values from
    // defaults and dashboard overrides.
    groups: z.array(z.string()).optional(),
    schedules: z
      .array(
        z.object({
          name: z.string(),
          cron: z.string(),
          timezone: z.string(),
          text: z.string(),
          previews: z.boolean(),
        }),
      )
      .optional(),
    ocr: z.boolean().optional(),
    searchCases: z.boolean().optional(),
    network: z.array(z.string()).optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    toolRetries: z.number().int().nonnegative().optional(),
    sandboxImage: z.string().optional(),
    // Checked with the SDK's own rules, so a manifest from another bundler or
    // an older SDK that asks for a sandbox without a size fails the deploy.
    sandbox: z
      .unknown()
      .superRefine((value, ctx) => {
        if (value === undefined) return;
        for (const message of sandboxProblems(value))
          ctx.addIssue({ code: "custom", message });
      })
      .transform((value) =>
        value === undefined
          ? undefined
          : sandboxManifest(value as SandboxManifest),
      )
      .optional(),
    evals: z.object({ onPush: z.boolean().optional() }).optional(),
    // Approvals the code requires (spec §9); a null group is any operator.
    approvals: z
      .object({
        groups: z.array(z.string()),
        agent: approvalRule.nullable(),
        fields: z.array(approvalRule.extend({ path: z.string() })),
        tools: z.array(approvalRule.extend({ name: z.string() })),
      })
      .optional(),
    declared: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional(),
  })
  // Keys this list does not name yet (the schema tree) are stored as sent.
  .loose();

export type Manifest = z.infer<typeof manifestSchema>;

export const deploymentTarget = (d: {
  organizationId: string;
  agentId: string;
  id: string;
  bundleSha256: string;
  network: NetworkRules;
}) => ({
  organizationId: d.organizationId,
  agentId: d.agentId,
  deploymentId: d.id,
  bundleHash: d.bundleSha256,
  network: d.network,
});

// Bound set = declared ∩ granted (doc 03), with each secret's version and
// ciphertext; values are decrypted only for a load.
const boundSecrets = async (tx: Tx, agentId: string, declared: string[]) => {
  if (declared.length === 0) return { bound: [], waiting: [] };
  const bound = await tx
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
    )
    .orderBy(secrets.name);
  const granted = new Set(bound.map((b) => b.name));
  return { bound, waiting: declared.filter((name) => !granted.has(name)) };
};

export type DeploymentRef = {
  organizationId: string;
  agentId: string;
  deploymentId: string;
};

// What one deployment's code receives right now. A deployment the deploy
// path has not recorded yet (its manifest read) receives nothing.
const deliverable = async (tx: Tx, d: DeploymentRef) => {
  const [row] = await tx
    .select({ manifest: deployments.manifest })
    .from(deployments)
    .where(
      and(
        eq(deployments.id, d.deploymentId),
        eq(deployments.agentId, d.agentId),
      ),
    );
  if (!row) return [];
  return (await boundSecrets(tx, d.agentId, (row.manifest as Manifest).secrets))
    .bound;
};

// Names the set of secrets and versions a deployment's code receives, so a
// change to any value or grant changes it (doc 03). The runtime asks for it
// on every call and loads a fresh isolate when it moves.
const versionOf = async (bound: { secretId: string; version: number }[]) => {
  if (bound.length === 0) return "none";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      bound.map((b) => `${b.secretId}:${b.version}`).join("\n"),
    ),
  );
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
};

export const secretsVersion = (env: Env, d: DeploymentRef) =>
  withOrg(env, orgId(d.organizationId), async (tx) =>
    versionOf(await deliverable(tx, d)),
  );

// The values themselves, for the isolate the runtime is loading. Each one
// delivered is audited (spec 12: which deployment received a secret).
export const secretValues = (env: Env, d: DeploymentRef) =>
  withOrg(env, orgId(d.organizationId), async (tx) => {
    const bound = await deliverable(tx, d);
    const values: Record<string, string> = {};
    for (const row of bound) {
      const key = await orgKeyVersion(
        env,
        tx,
        d.organizationId,
        row.keyVersion,
      );
      values[row.name] = await decrypt(
        key,
        row.ciphertext,
        `${d.organizationId}|${row.secretId}|${row.version}`,
      );
      await audit(tx, {
        organizationId: d.organizationId,
        actorType: "platform",
        actorId: "runtime",
        action: "secret.delivered",
        targetType: "secret",
        targetId: row.secretId,
        data: {
          secret: row.name,
          version: row.version,
          deployment: d.deploymentId,
        },
      });
    }
    return { version: await versionOf(bound), values };
  });

// The groups a deployment's code names (design doc 06), and those without
// access to the agent: no grant on it and not Developers. A group without
// access holds the deployment in waiting, like an ungranted secret, so an
// agent never runs with one; an unknown slug fails the deploy instead.
// A group the code names waits for access to the agent; one it names to
// approve waits for operator access, since viewers never approve.
const namedGroups = async (tx: Tx, agentId: string, manifest: Manifest) => {
  const approving = new Set(manifest.approvals?.groups ?? []);
  const slugs = [...new Set([...(manifest.groups ?? []), ...approving])];
  if (slugs.length === 0) return { named: [], waitingGroups: [] };
  const named = await tx
    .select({
      id: groups.id,
      slug: groups.slug,
      isDevelopers: groups.isDevelopers,
      access: agentGrants.access,
    })
    .from(groups)
    .leftJoin(
      agentGrants,
      and(eq(agentGrants.groupId, groups.id), eq(agentGrants.agentId, agentId)),
    )
    .where(inArray(groups.slug, slugs));
  return {
    named: named.map((g) => ({ ...g, approves: approving.has(g.slug) })),
    waitingGroups: named
      .filter(
        (g) =>
          !g.isDevelopers &&
          (g.access === null ||
            (approving.has(g.slug) && g.access !== "operator")),
      )
      .map((g) => g.slug),
  };
};

// Whether a live deployment's code names the group (design doc 01, q29): the
// group, or its access to agentId when given, cannot be removed while so.
export const groupInUse = async (tx: Tx, groupId: string, agentId?: string) => {
  const agentIds = agentId
    ? [agentId]
    : (
        await tx
          .selectDistinct({ agentId: deployments.agentId })
          .from(deploymentGroups)
          .innerJoin(
            deployments,
            eq(deployments.id, deploymentGroups.deploymentId),
          )
          .where(eq(deploymentGroups.groupId, groupId))
      ).map((r) => r.agentId);
  for (const id of agentIds) {
    const live = (await liveDeployments(tx, id)).map((d) => d.id);
    if (live.length === 0) continue;
    const [named] = await tx
      .select({ id: deploymentGroups.deploymentId })
      .from(deploymentGroups)
      .where(
        and(
          eq(deploymentGroups.groupId, groupId),
          inArray(deploymentGroups.deploymentId, live),
        ),
      )
      .limit(1);
    if (named) return true;
  }
  return false;
};

// Brings one deployment's record in line with current grants: what it waits
// for, its network rules and the groups its code names. Secrets need nothing
// here: the runtime reads them when it loads the code (doc 03). Returns what
// the deployment still waits for.
export const syncDeployment = async (
  tx: Tx,
  org: OrgId,
  deploymentId: string,
): Promise<string[]> => {
  const [deployment] = await tx
    .select()
    .from(deployments)
    .where(eq(deployments.id, deploymentId));
  if (!deployment)
    throw new HTTPException(404, { message: "deployment not found" });
  const manifest = deployment.manifest as Manifest;
  const { waiting } = await boundSecrets(
    tx,
    deployment.agentId,
    manifest.secrets,
  );
  const granted = manifest.mcp.length
    ? await tx
        .select({ slug: mcpServers.slug })
        .from(mcpGrants)
        .innerJoin(mcpServers, eq(mcpServers.id, mcpGrants.serverId))
        .where(eq(mcpGrants.agentId, deployment.agentId))
    : [];
  const waitingMcp = manifest.mcp.filter(
    (slug) => !granted.some((g) => g.slug === slug),
  );
  const network = await effectiveNetwork(tx, deployment.agentId);
  const waitingNetwork = (manifest.network ?? []).filter(
    (host) => !permits(network, host),
  );
  const { named, waitingGroups } = await namedGroups(
    tx,
    deployment.agentId,
    manifest,
  );
  const sandboxCap = manifest.sandbox ? await sandboxMaxSize(tx) : null;
  const waitingSandbox =
    manifest.sandbox && !sizeAllowed(sandboxCap, manifest.sandbox.size)
      ? manifest.sandbox.size
      : null;
  await tx
    .delete(deploymentGroups)
    .where(eq(deploymentGroups.deploymentId, deploymentId));
  if (named.length)
    await tx.insert(deploymentGroups).values(
      named.map((g) => ({
        organizationId: org,
        deploymentId,
        groupId: g.id,
        approves: g.approves,
      })),
    );
  const layer = deployment.sandboxLayer?.status;
  const status =
    deployment.status === "failed" || layer === "failed"
      ? "failed"
      : layer === "building"
        ? "building"
        : waiting.length ||
            waitingMcp.length ||
            waitingNetwork.length ||
            waitingGroups.length ||
            waitingSandbox
          ? "waiting"
          : "ready";
  const waitingFor: WaitingFor = {
    ...(waiting.length && { secrets: waiting }),
    ...(waitingMcp.length && { mcp: waitingMcp }),
    ...(waitingNetwork.length && { network: waitingNetwork }),
    ...(waitingGroups.length && { groups: waitingGroups }),
    ...(waitingSandbox && { sandboxSize: waitingSandbox }),
  };
  await tx
    .update(deployments)
    .set({ status, waitingFor, network })
    .where(eq(deployments.id, deploymentId));
  if (status === "ready" && deployment.status !== "ready")
    await startPushRuns(tx, org, deployment);
  const existingSecrets = waiting.length
    ? await tx
        .select({ name: secrets.name })
        .from(secrets)
        .where(inArray(secrets.name, waiting))
    : [];
  const existingMcp = waitingMcp.length
    ? await tx
        .select({ slug: mcpServers.slug })
        .from(mcpServers)
        .where(inArray(mcpServers.slug, waitingMcp))
    : [];
  await requestLoosening(tx, org, deployment, [
    ...waitingNetwork.map((host) => ({
      kind: "network" as const,
      hosts: [host],
    })),
    ...existingSecrets.map((s) => ({
      kind: "secret" as const,
      secret: s.name,
    })),
    ...existingMcp.map((m) => ({ kind: "mcp" as const, server: m.slug })),
    ...(waitingSandbox
      ? [{ kind: "sandbox_size" as const, size: waitingSandbox }]
      : []),
  ]);
  return [
    ...waiting,
    ...waitingMcp.map((slug) => `MCP server ${slug}`),
    ...waitingNetwork.map((host) => `network access to ${host}`),
    ...waitingGroups.map((slug) => `access for group ${slug}`),
    ...(waitingSandbox
      ? [
          `a ${waitingSandbox} sandbox (the organization allows up to ${sandboxCap})`,
        ]
      : []),
  ];
};

const covers = (asked: GuardrailChange, needed: GuardrailChange) => {
  switch (needed.kind) {
    case "network":
      return (
        asked.kind === "network" &&
        needed.hosts.every((host) => asked.hosts.includes(host))
      );
    case "secret":
      return asked.kind === "secret" && asked.secret === needed.secret;
    case "mcp":
      return asked.kind === "mcp" && asked.server === needed.server;
    case "sandbox_size":
      return asked.kind === "sandbox_size" && asked.size === needed.size;
    case "spending_limit":
      return false;
  }
};

// A live deployment that asks for more than its guardrails allow files the
// loosening requests itself (spec 5): one per blocked host, secret or MCP
// server, unless a pending request already covers it or this deployment
// already asked. Its pending requests are withdrawn once it no longer needs
// them or another deployment supersedes it.
const requestLoosening = async (
  tx: Tx,
  org: OrgId,
  deployment: { id: string; agentId: string },
  blocked: GuardrailChange[],
) => {
  const live = new Set(
    (await liveDeployments(tx, deployment.agentId)).map((d) => d.id),
  );
  const needed = live.has(deployment.id) ? blocked : [];
  const requests = await tx
    .select({
      id: guardrailRequests.id,
      agentId: guardrailRequests.agentId,
      deploymentId: guardrailRequests.deploymentId,
      change: guardrailRequests.change,
      status: guardrailRequests.status,
    })
    .from(guardrailRequests)
    .where(
      or(
        eq(guardrailRequests.deploymentId, deployment.id),
        and(
          eq(guardrailRequests.status, "pending"),
          or(
            eq(guardrailRequests.agentId, deployment.agentId),
            isNull(guardrailRequests.agentId),
          ),
        ),
      ),
    );
  const withdrawn = requests.filter(
    (r) =>
      r.status === "pending" &&
      r.deploymentId !== null &&
      r.agentId === deployment.agentId &&
      (!live.has(r.deploymentId) ||
        (r.deploymentId === deployment.id &&
          !needed.some((change) => covers(r.change, change)))),
  );
  if (withdrawn.length)
    await tx.delete(guardrailRequests).where(
      inArray(
        guardrailRequests.id,
        withdrawn.map((r) => r.id),
      ),
    );
  for (const r of withdrawn)
    await audit(tx, {
      organizationId: org,
      actorType: "platform",
      actorId: r.deploymentId!,
      action: "guardrail.request.withdrawn",
      targetType: "guardrail_request",
      targetId: r.id,
      data: { change: r.change, agent: r.agentId },
    });
  const standing = requests.filter(
    (r) =>
      !withdrawn.includes(r) &&
      (r.status === "pending" || r.deploymentId === deployment.id),
  );
  for (const change of needed) {
    if (standing.some((r) => covers(r.change, change))) continue;
    const id = newId("guardrailRequest");
    await tx.insert(guardrailRequests).values({
      id,
      organizationId: org,
      kind: change.kind,
      agentId: deployment.agentId,
      deploymentId: deployment.id,
      change,
      requestedByType: "deployment",
      requestedBy: deployment.id,
    });
    await audit(tx, {
      organizationId: org,
      actorType: "platform",
      actorId: deployment.id,
      action: "guardrail.request.created",
      targetType: "guardrail_request",
      targetId: id,
      data: { change, agent: deployment.agentId, deployment: deployment.id },
    });
  }
};

// Live deployments (doc 03): the production deployment and the newest
// deployment of every other branch. Older ones are rechecked when promoted
// again.
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

// Inside the transaction that changes what agents' code may receive (a grant,
// network rules, a group's access): their live deployments recheck what they
// wait for before it commits.
export const syncAgents = async (tx: Tx, org: OrgId, agentIds: string[]) => {
  for (const agentId of new Set(agentIds))
    for (const d of await liveDeployments(tx, agentId))
      await syncDeployment(tx, org, d.id);
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
    if (created) {
      await audit(tx, {
        organizationId: org,
        ...actor,
        action: "agent.created",
        targetType: "agent",
        targetId: created.id,
        data: { slug },
      });
      await grantViewersNewAgent(tx, org, created.id);
    }
    const [agent] = await tx.select().from(agents).where(eq(agents.slug, slug));
    return agent!;
  });
  if (agent.archivedAt)
    throw new HTTPException(409, { message: "agent is archived" });

  const id = newId("deployment");
  const bundleSha256 = await env.RUNTIME.putBundle(
    { organizationId: org, agentId: agent.id, deploymentId: id },
    input.bundle,
  );
  const target = { organizationId: org, agentId: agent.id, id, bundleSha256 };
  const read = manifestSchema.safeParse(
    await env.RUNTIME.manifest(
      deploymentTarget({
        ...target,
        network: await withOrg(env, org, (tx) =>
          effectiveNetwork(tx, agent.id),
        ),
      }),
    ).catch((error: unknown) => {
      throw new HTTPException(422, {
        message: `the agent's Worker did not serve its manifest: ${String(error)}`,
      });
    }),
  );
  if (!read.success)
    throw new HTTPException(422, {
      message: `the agent's manifest is invalid: ${z.prettifyError(read.error)}`,
    });
  const manifest = read.data;
  for (const s of manifest.schedules ?? []) {
    try {
      nextFire(s, new Date());
    } catch (error) {
      throw new HTTPException(422, {
        message: `schedule ${s.name} has an invalid cron or timezone: ${String(error)}`,
      });
    }
  }

  const setup = manifest.sandbox?.setup;
  if (setup && !(await customImagesAllowed(env, org)))
    throw new HTTPException(403, {
      message:
        "custom sandbox environments (sandbox.setup) need the Team plan or above; presets and sandbox.packages work on every plan",
    });

  await withOrg(env, org, async (tx) => {
    const slugs = manifest.groups ?? [];
    const known = slugs.length
      ? await tx
          .select({ slug: groups.slug })
          .from(groups)
          .where(inArray(groups.slug, slugs))
      : [];
    const unknown = slugs.filter((s) => !known.some((k) => k.slug === s));
    if (unknown.length)
      throw new HTTPException(422, {
        message: `the code names groups this organization does not have: ${unknown.join(", ")}`,
      });
    await assertModelAllowed(
      tx,
      (await effectiveSettings(tx, agent.id, manifest)).model,
    );
    await tx.insert(deployments).values({
      id,
      organizationId: org,
      agentId: agent.id,
      // Ready once the first sync finds nothing it waits for.
      status: "waiting",
      bundleSha256,
      sdkVersion: manifest.sdk.version,
      ...(setup && {
        status: "building" as const,
        sandboxLayer: { status: "building" as const },
      }),
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
    await markDeveloper(tx, env, org, actor);
  });
  const waiting = await withOrg(env, org, (tx) => syncDeployment(tx, org, id));
  const production = input.git.branch === agent.productionBranch;
  // The build reports back through Platform.sandboxLayerBuilt, which
  // promotes a production deployment once nothing else holds it.
  if (setup)
    await env.RUNTIME.queueSandboxLayer(
      {
        organizationId: org,
        agentId: agent.id,
        preset: manifest.sandbox!.preset,
        setup,
        network: await withOrg(env, org, (tx) =>
          effectiveNetwork(tx, agent.id),
        ),
      },
      { organizationId: org, agentId: agent.id, deploymentId: id },
    ).catch((error: unknown) =>
      layerBuilt(env, {
        deployment: {
          organizationId: org,
          agentId: agent.id,
          deploymentId: id,
        },
        result: { error: `the build could not start: ${String(error)}` },
      }),
    );
  // A preview runs its own scheduler; each fire checks the deployment is
  // still live and the schedule may run on previews.
  if (!production && manifest.schedules?.length)
    await env.SCHEDULER.getByName(schedulerName(org, agent.id, id)).replace({
      organizationId: org,
      agentId: agent.id,
      previewId: id,
      schedules: manifest.schedules,
    });
  const cleared =
    waiting.length === 0 && production && !setup
      ? await promote(env, org, agent.id, id, actor)
      : [];
  const deployed = await getDeployment(env, org, agent.id, id);
  return { ...deployed, warnings: [...deployed.warnings, ...cleared] };
};

const clearedWarning = (key: string, value: unknown) =>
  `promotion cleared the dashboard override of ${key} (${JSON.stringify(value)})`;

export const promote = async (
  env: Env,
  org: OrgId,
  agentId: string,
  deploymentId: string,
  actor: Actor,
) => {
  const [target] = await withOrg(env, org, (tx) =>
    tx
      .select({
        environment: deployments.environment,
        manifest: deployments.manifest,
        sandboxLayer: deployments.sandboxLayer,
      })
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
  if (target.sandboxLayer && target.sandboxLayer.status !== "ready")
    throw new HTTPException(409, {
      message:
        target.sandboxLayer.status === "building"
          ? "the deployment's custom sandbox environment is still building"
          : "the deployment's custom sandbox environment failed to build",
    });
  // An older deployment never brings back a revoked grant or an old value.
  const waiting = await withOrg(env, org, (tx) =>
    syncDeployment(tx, org, deploymentId),
  );
  if (waiting.length)
    throw new HTTPException(409, {
      message: `deployment is waiting for grants: ${waiting.join(", ")}`,
    });
  // Code is the truth again (spec 5): the agent's dashboard overrides go.
  const cleared = await withOrg(env, org, async (tx) => {
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
    await markDeveloper(tx, env, org, actor);
    const cleared = await clearOverrides(
      tx,
      agentId,
      { organizationId: org, ...actor },
      deploymentId,
    );
    return Object.entries(cleared).map(([key, value]) =>
      clearedWarning(key, value),
    );
  });
  // The agent's scheduler now holds this deployment's schedules.
  await env.SCHEDULER.getByName(schedulerName(org, agentId)).replace({
    organizationId: org,
    agentId,
    previewId: null,
    schedules: (target.manifest as Manifest).schedules ?? [],
  });
  return cleared;
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
  warnings: [
    ...((d.manifest as Manifest).warnings ?? []),
    ...(d.sandboxLayer?.status === "ready" && d.sandboxLayer.warning
      ? [d.sandboxLayer.warning]
      : []),
  ],
  sandboxEnvironment: d.sandboxLayer
    ? d.sandboxLayer.status === "ready"
      ? { status: "ready" as const, bytes: d.sandboxLayer.bytes }
      : d.sandboxLayer.status === "failed"
        ? {
            status: "failed" as const,
            error: d.sandboxLayer.error,
            log: d.sandboxLayer.log ?? null,
          }
        : { status: "building" as const }
    : null,
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
    const production = await productionId(tx, agentId);
    const shown = view(d, production);
    if (d.environment !== "production" || d.id === production) return shown;
    const overrides = await agentOverrideValues(tx, agentId);
    return {
      ...shown,
      warnings: [
        ...shown.warnings,
        ...overrideWarnings(overrides, d.manifest as Manifest),
      ],
    };
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
