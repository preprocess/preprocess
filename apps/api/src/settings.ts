// Settings that are defaults, not guardrails (spec 5): each agent setting comes
// from a dashboard override, the deployment's code, the organization's
// default, or the platform's default, in that order. Code is the truth at
// deploy, so promoting a deployment clears the agent's overrides.

import { audit } from "@preprocess/db/audit";
import type { AuditInput } from "@preprocess/db/audit";
import type { Tx } from "@preprocess/db/client";
import {
  agentOverrides,
  organizationDefaults,
} from "@preprocess/db/schema/settings";
import type { SettingValues } from "@preprocess/db/schema/settings";
import {
  currentModel,
  DEFAULT_MODEL,
  MODELS,
  REASONING,
  SANDBOX_SIZES,
  type SandboxSize,
} from "@preprocess/sdk/protocol";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Manifest } from "./deploy.ts";

// Settings an organization can default. `fallback` is the platform's value
// when nothing sets one; null means the runtime's own behavior.
export const DEFAULTS = {
  model: { schema: z.enum(MODELS), fallback: DEFAULT_MODEL },
  reasoning: { schema: z.enum(REASONING), fallback: "medium" },
  ocr: { schema: z.boolean(), fallback: false },
  searchCases: { schema: z.boolean(), fallback: false },
  timeoutSeconds: { schema: z.number().int().positive(), fallback: null },
  toolRetries: { schema: z.number().int().nonnegative(), fallback: null },
  sandboxImage: { schema: z.string().trim().min(1), fallback: null },
  "evals.onPush": { schema: z.boolean(), fallback: false },
} as const;

export type DefaultKey = keyof typeof DEFAULTS;
export const DEFAULT_KEYS = Object.keys(DEFAULTS) as DefaultKey[];

const SCHEDULE_PREVIEWS = /^schedules\.([^.]+)\.previews$/;

// The sandbox size: set by code that asks for a sandbox, overridable from the
// dashboard, and never an organization default, since a sandbox is opt-in and
// has no default size (spec 3).
export const SANDBOX_SIZE_KEY = "sandbox.size";

export type Source = "override" | "code" | "organization" | "default";

// The schema for a key an agent can override, or undefined for an unknown key.
export const settingSchema = (key: string): z.ZodType | undefined =>
  key in DEFAULTS
    ? DEFAULTS[key as DefaultKey].schema
    : SCHEDULE_PREVIEWS.test(key)
      ? z.boolean()
      : key === SANDBOX_SIZE_KEY
        ? z.enum(SANDBOX_SIZES)
        : undefined;

const codeValue = (manifest: Manifest, key: string): unknown => {
  const schedule = SCHEDULE_PREVIEWS.exec(key)?.[1];
  if (schedule)
    return manifest.schedules?.find((s) => s.name === schedule)?.previews;
  if (key === "evals.onPush") return manifest.evals?.onPush;
  if (key === SANDBOX_SIZE_KEY) return manifest.sandbox?.size;
  return manifest[key];
};

// Whether the code set the key. Manifests from before `declared` existed
// count every value they carry, except the SDK's model and reasoning.
const declares = (manifest: Manifest, key: string) => {
  const declared = manifest.declared;
  if (!declared)
    return (
      key !== "model" &&
      key !== "reasoning" &&
      codeValue(manifest, key) !== undefined
    );
  return (
    declared.includes(key) ||
    (key === "evals.onPush" && declared.includes("evals")) ||
    (key === SANDBOX_SIZE_KEY && manifest.sandbox !== undefined)
  );
};

export type Setting = {
  key: string;
  value: unknown;
  source: Source;
  code: unknown;
  organization: unknown;
  override: unknown;
};

export const organizationDefaultValues = async (tx: Tx) =>
  (
    await tx
      .select({ values: organizationDefaults.values })
      .from(organizationDefaults)
  )[0]?.values ?? {};

export const agentOverrideValues = async (tx: Tx, agentId: string) =>
  (
    await tx
      .select({ values: agentOverrides.values })
      .from(agentOverrides)
      .where(eq(agentOverrides.agentId, agentId))
  )[0]?.values ?? {};

// Every setting of an agent with its source. Without a deployment there is no
// code, so only overrides and defaults apply.
export const resolveSettings = async (
  tx: Tx,
  agentId: string,
  manifest: Manifest | null,
): Promise<Setting[]> => {
  const organization = await organizationDefaultValues(tx);
  const overrides = await agentOverrideValues(tx, agentId);
  const keys = [
    ...DEFAULT_KEYS,
    ...(manifest?.schedules ?? []).map((s) => `schedules.${s.name}.previews`),
    ...(manifest?.sandbox ? [SANDBOX_SIZE_KEY] : []),
  ];
  return keys.map((key) => {
    const code =
      manifest && declares(manifest, key)
        ? codeValue(manifest, key)
        : undefined;
    const org = key in DEFAULTS ? organization[key] : undefined;
    const fallback =
      key in DEFAULTS
        ? DEFAULTS[key as DefaultKey].fallback
        : key === SANDBOX_SIZE_KEY
          ? null
          : false;
    const [stored, source]: [unknown, Source] =
      overrides[key] !== undefined
        ? [overrides[key], "override"]
        : code !== undefined
          ? [code, "code"]
          : org !== undefined
            ? [org, "organization"]
            : [fallback, "default"];
    const value =
      key === "model" && typeof stored === "string"
        ? currentModel(stored)
        : stored;
    return {
      key,
      value,
      source,
      code: code ?? null,
      organization: org ?? null,
      override: overrides[key] ?? null,
    };
  });
};

// The values the runtime applies over the deployment's manifest.
export type EffectiveSettings = {
  model: string;
  reasoning: string;
  ocr: boolean;
  searchCases: boolean;
  timeoutSeconds: number | null;
  toolRetries: number | null;
  sandboxImage: string | null;
  // Null when the code asks for no sandbox.
  sandboxSize: SandboxSize | null;
  evals: { onPush: boolean };
  schedules: Record<string, { previews: boolean }>;
};

export const effectiveSettings = async (
  tx: Tx,
  agentId: string,
  manifest: Manifest,
): Promise<EffectiveSettings> => {
  const values = new Map(
    (await resolveSettings(tx, agentId, manifest)).map((s) => [s.key, s.value]),
  );
  return {
    model: values.get("model") as string,
    reasoning: values.get("reasoning") as string,
    ocr: values.get("ocr") as boolean,
    searchCases: values.get("searchCases") as boolean,
    timeoutSeconds: values.get("timeoutSeconds") as number | null,
    toolRetries: values.get("toolRetries") as number | null,
    sandboxImage: values.get("sandboxImage") as string | null,
    sandboxSize: manifest.sandbox
      ? (values.get(SANDBOX_SIZE_KEY) as SandboxSize)
      : null,
    evals: { onPush: values.get("evals.onPush") as boolean },
    schedules: Object.fromEntries(
      (manifest.schedules ?? []).map((s) => [
        s.name,
        { previews: values.get(`schedules.${s.name}.previews`) as boolean },
      ]),
    ),
  };
};

// What promoting a deployment with this manifest would clear.
export const overrideWarnings = (
  overrides: SettingValues,
  manifest: Manifest,
) =>
  Object.entries(overrides).map(([key, value]) => {
    const code = declares(manifest, key) ? codeValue(manifest, key) : undefined;
    return code !== undefined && JSON.stringify(code) !== JSON.stringify(value)
      ? `${key} is ${JSON.stringify(value)} in the dashboard but ${JSON.stringify(code)} in code; promoting this deployment clears the override`
      : `promoting this deployment clears the dashboard override of ${key} (${JSON.stringify(value)})`;
  });

// Promotion makes code the truth again: the agent's overrides go, audited.
export const clearOverrides = async (
  tx: Tx,
  agentId: string,
  event: Pick<
    AuditInput,
    "organizationId" | "actorType" | "actorId" | "ip" | "requestId"
  >,
  deploymentId: string,
) => {
  const [cleared] = await tx
    .delete(agentOverrides)
    .where(eq(agentOverrides.agentId, agentId))
    .returning({ values: agentOverrides.values });
  const keys = Object.keys(cleared?.values ?? {});
  if (keys.length)
    await audit(tx, {
      ...event,
      action: "settings.overrides.cleared",
      targetType: "agent",
      targetId: agentId,
      data: { deployment: deploymentId, cleared: cleared!.values },
    });
  return cleared?.values ?? {};
};
