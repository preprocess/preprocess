// Custom sandbox environments (spec 3): a preset plus an agent's setup steps,
// built once into a squashfs layer and mounted over the preset at every start
// (apps/runtime/sandbox/layer). A layer lives in BUNDLES at
// org/<org>/layers/<sha256 of the preset image, the setup and the format>, so
// the same setup on the same image is built once per organization, and a new
// preset image gives a new key. Only the deployment row names the layer a
// sandbox mounts, and every read checks the key is under the organization.

import type { SandboxPreset, SandboxSetup } from "@preprocess/sdk/protocol";

import type { DeploymentRef, NetworkRules } from "./env.ts";

// Bump when build.sh changes what a layer holds, so every layer rebuilds.
export const LAYER_FORMAT = 1;

// Layers build on the largest instance type, so a build that fits any size's
// disk fits here, and installs run on 4 vCPU.
export const LAYER_INSTANCE = "standard-4";

// The longest a setup may run, and how long the container may then sit idle.
export const LAYER_BUILD_SECONDS = 10 * 60;

export const LAYER_LOG_CHARS = 32_000;

export type LayerJob = {
  organizationId: string;
  agentId: string;
  preset: SandboxPreset;
  setup: SandboxSetup;
  network: NetworkRules;
};

export type Layer = {
  key: string;
  image: string;
  bytes: number;
  unpackedBytes: number;
};

export type LayerResult = Layer | { error: string; log?: string };

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

const sha256 = async (text: string) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

// Object keys in a fixed order, so the same setup always hashes the same.
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
        )
      : value;

export const layerPrefix = (organizationId: string) =>
  `org/${organizationId}/layers/`;

export const layerKey = async (
  organizationId: string,
  image: string,
  setup: SandboxSetup,
) =>
  layerPrefix(organizationId) +
  (await sha256(
    JSON.stringify(canonical({ format: LAYER_FORMAT, image, setup })),
  ));

// One builder object per organization, preset and setup, so concurrent
// deploys of the same setup share a build.
export const layerBuilderName = async (job: LayerJob) =>
  `layer:${job.organizationId}:${await sha256(
    JSON.stringify(canonical({ preset: job.preset, setup: job.setup })),
  )}`;

export const ownsLayer = (organizationId: string, key: string) =>
  key.startsWith(layerPrefix(organizationId)) &&
  /^[0-9a-f]{64}$/.test(key.slice(layerPrefix(organizationId).length));

// Where a deploy's queued build reports, and what it waits for.
export type QueuedLayer = { job: LayerJob; waiting: DeploymentRef[] };

// The two lines build.sh ends with.
export const parseLayerSizes = (output: string) => {
  const bytes = /^LAYER_BYTES=(\d+)$/m.exec(output)?.[1];
  const unpacked = /^LAYER_UNPACKED_BYTES=(\d+)$/m.exec(output)?.[1];
  if (!bytes || !unpacked) return null;
  return { bytes: Number(bytes), unpackedBytes: Number(unpacked) };
};
