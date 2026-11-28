// Custom sandbox environments (spec 3): a deployment's sandbox setup, built by
// the runtime into a layer in R2 under org/<org>/layers/. The API records the
// layer on the deployment row, the only place a sandbox learns which layer to
// mount, refuses one that does not fit the chosen size's disk with the
// preset, counts each layer in the organization's stored bytes (billed as
// storage), and collects layers no live deployment names.

import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
import {
  deployments,
  sandboxLayers,
  type DeploymentLayer,
} from "@preprocess/db/schema/deployments";
import {
  SANDBOX_SIZES,
  type SandboxPreset,
  type SandboxSize,
} from "@preprocess/sdk/protocol";
import { and, eq, lt, sql } from "drizzle-orm";

import type { DeploymentRef, Manifest } from "./deploy.ts";
import { trackEvent } from "./analytics.ts";
import { promote, syncDeployment } from "./deploy.ts";
import type { Env, SandboxLayer, SandboxLayerResult } from "./env.ts";
import { caseSandboxSizes, sandboxSizes } from "./sandbox.ts";

// Each preset image's size on disk, uncompressed (PLAT-76, 2026-11-26).
export const PRESET_BYTES: Record<SandboxPreset, number> = {
  standard: 272_000_000,
  node: 467_000_000,
  python: 342_000_000,
  "python-data": 1_350_000_000,
};

// Past this, a deploy warns about the start time a layer adds.
export const LARGE_LAYER_BYTES = 1_000_000_000;
// How fast a sandbox downloads its layer from R2 (PLAT-79, standard-1).
const LAYER_BYTES_PER_SECOND = 25_000_000;

// A layer is collected once it is this old and no live deployment names it.
export const LAYER_GRACE_MS = 24 * 60 * 60 * 1000;

const diskBytes = (size: SandboxSize) =>
  sandboxSizes[caseSandboxSizes[size]].diskGb * 1_000_000_000;

const gb = (bytes: number) => (bytes / 1_000_000_000).toFixed(1);

export const layerPrefix = (organizationId: string) =>
  `org/${organizationId}/layers/`;

export const ownsLayer = (organizationId: string, key: string) =>
  key.startsWith(layerPrefix(organizationId)) &&
  /^[0-9a-f]{64}$/.test(key.slice(layerPrefix(organizationId).length));

// The smallest size whose disk holds the preset and the layer, if any does.
export const fittingSize = (preset: SandboxPreset, bytes: number) =>
  SANDBOX_SIZES.find(
    (size) => PRESET_BYTES[preset] + bytes <= diskBytes(size),
  ) ?? null;

export const layerFitError = (
  size: SandboxSize,
  preset: SandboxPreset,
  bytes: number,
) => {
  const fits = fittingSize(preset, bytes);
  return (
    `the custom environment (${gb(bytes)} GB) and the ${preset} preset (${gb(PRESET_BYTES[preset])} GB) do not fit a ${size} sandbox's ${gb(diskBytes(size))} GB disk` +
    (fits
      ? `; set sandbox.size to "${fits}"`
      : "; no sandbox size has a disk that large")
  );
};

export const layerWarning = (bytes: number) =>
  bytes > LARGE_LAYER_BYTES
    ? `the custom environment is ${gb(bytes)} GB, which adds about ${Math.ceil(
        bytes / LAYER_BYTES_PER_SECOND,
      )} seconds to every sandbox start and wake`
    : undefined;

// The layer a deployment's row names, for the runtime to mount. Null when
// it has none ready or the layer was collected, so the runtime builds it.
export const deploymentLayer = (env: Env, d: DeploymentRef) =>
  withOrg(env, orgId(d.organizationId), async (tx) => {
    const [row] = await tx
      .select({ layer: deployments.sandboxLayer })
      .from(deployments)
      .where(
        and(
          eq(deployments.id, d.deploymentId),
          eq(deployments.agentId, d.agentId),
        ),
      );
    const layer = row?.layer;
    if (layer?.status !== "ready" || !ownsLayer(d.organizationId, layer.key))
      return null;
    const [stored] = await tx
      .select()
      .from(sandboxLayers)
      .where(eq(sandboxLayers.key, layer.key));
    if (!stored) return null;
    return {
      key: stored.key,
      image: stored.image,
      bytes: stored.bytes,
      unpackedBytes: stored.unpackedBytes,
    } satisfies SandboxLayer;
  });

// A build's result for one deployment. A deploy's build moves the
// deployment out of building, to ready (then promoting it from the
// production branch), waiting, or failed. A build a sandbox start asked for,
// after a preset image changed or the layer was collected, only replaces the
// layer when it fits.
export const layerBuilt = async (
  env: Env,
  built: { deployment: DeploymentRef; result: SandboxLayerResult },
): Promise<{ ok: true } | { error: string }> => {
  const { deployment: ref, result } = built;
  const org = orgId(ref.organizationId);
  const outcome = await withOrg(env, org, async (tx) => {
    const [d] = await tx
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.id, ref.deploymentId),
          eq(deployments.agentId, ref.agentId),
        ),
      )
      .for("update");
    const sandbox = (d?.manifest as Manifest | undefined)?.sandbox;
    if (!d || !sandbox?.setup)
      return { error: "the deployment has no custom environment" };
    const deploying = d.sandboxLayer?.status === "building";
    const fail = async (error: string, log?: string) => {
      if (deploying) {
        const failed: DeploymentLayer = {
          status: "failed",
          error,
          ...(log && { log }),
        };
        await tx
          .update(deployments)
          .set({ status: "failed", sandboxLayer: failed })
          .where(eq(deployments.id, d.id));
      }
      return { error, failedDeploy: deploying ? d.source : null };
    };
    if ("error" in result) return fail(result.error, result.log);
    if (!ownsLayer(ref.organizationId, result.key))
      return fail("the layer is not under this organization");
    const fits = fittingSize(sandbox.preset, result.bytes);
    if (
      !fits ||
      SANDBOX_SIZES.indexOf(fits) > SANDBOX_SIZES.indexOf(sandbox.size)
    )
      return fail(layerFitError(sandbox.size, sandbox.preset, result.bytes));
    await tx
      .insert(sandboxLayers)
      .values({
        organizationId: ref.organizationId,
        key: result.key,
        image: result.image,
        bytes: result.bytes,
        unpackedBytes: result.unpackedBytes,
      })
      .onConflictDoNothing();
    const warning = layerWarning(result.bytes);
    await tx
      .update(deployments)
      .set({
        sandboxLayer: {
          status: "ready",
          key: result.key,
          image: result.image,
          bytes: result.bytes,
          ...(warning && { warning }),
        },
      })
      .where(eq(deployments.id, d.id));
    if (!deploying) return { ok: true as const };
    const waiting = await syncDeployment(tx, org, d.id);
    return {
      ok: true as const,
      promote: waiting.length === 0 && d.environment === "production",
    };
  });
  if ("failedDeploy" in outcome && outcome.failedDeploy)
    await trackEvent(env, "deployment_failed", ref.organizationId, null, {
      agent_id: ref.agentId,
      deployment_id: ref.deploymentId,
      source: outcome.failedDeploy,
      failure: "environment_build_failed",
    });
  if ("promote" in outcome && outcome.promote)
    await promote(env, org, ref.agentId, ref.deploymentId, {
      actorType: "platform",
      actorId: `sandbox-layer:${ref.deploymentId}`,
    });
  return "error" in outcome ? { error: outcome.error } : { ok: true };
};

// Daily: layers older than a day that no live deployment of their
// organization names (each agent's production deployment and newest
// deployment per branch). A deployment whose layer goes is rebuilt the next
// time its sandbox starts.
export const collectSandboxLayers = async (env: Env, now = new Date()) => {
  const unused = await withoutOrg(env, "sandbox layers: unused", (tx) =>
    tx
      .select({
        organizationId: sandboxLayers.organizationId,
        key: sandboxLayers.key,
      })
      .from(sandboxLayers)
      .where(
        and(
          lt(sandboxLayers.createdAt, new Date(now.getTime() - LAYER_GRACE_MS)),
          sql`not exists (
            select 1 from deployments d
            where d.organization_id = ${sandboxLayers.organizationId}
              and d.sandbox_layer->>'key' = ${sandboxLayers.key}
              and (
                d.id = (
                  select p.id from deployments p
                  where p.agent_id = d.agent_id and p.promoted_at is not null
                  order by p.promoted_at desc limit 1)
                or d.id = (
                  select b.id from deployments b
                  where b.agent_id = d.agent_id
                    and coalesce(b.git_branch, '') = coalesce(d.git_branch, '')
                  order by b.created_at desc limit 1)))`,
        ),
      ),
  );
  for (const layer of unused)
    try {
      if (
        !(await env.RUNTIME.deleteSandboxLayer(layer.organizationId, layer.key))
      )
        throw new Error("the runtime refused the key");
      await withOrg(env, orgId(layer.organizationId), (tx) =>
        tx.delete(sandboxLayers).where(eq(sandboxLayers.key, layer.key)),
      );
    } catch (error) {
      console.error("sandbox layers: collect", layer.key, error);
    }
};
