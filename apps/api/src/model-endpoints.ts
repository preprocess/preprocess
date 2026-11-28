// Model endpoints an organization registers (design doc 10, section 4): an
// OpenAI-compatible URL that serves a catalogue model in place of its
// provider. The key is envelope-encrypted with the organization's data key
// (crypto.ts) and decrypted only here, for the runtime at case start and for
// an endpoint test; it is never returned by the API.

import { orgId, withOrg, type Tx } from "@preprocess/db/client";
import { agents } from "@preprocess/db/schema/access";
import { deployments } from "@preprocess/db/schema/deployments";
import { evalRuns, evalSuites } from "@preprocess/db/schema/evals";
import { modelEndpoints } from "@preprocess/db/schema/models";
import {
  agentOverrides,
  organizationDefaults,
} from "@preprocess/db/schema/settings";
import { isOrgModel } from "@preprocess/sdk/protocol";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { ApiError } from "./cases.ts";
import { decrypt, encrypt, orgKey, orgKeyVersion } from "./crypto.ts";
import { liveDeployments } from "./deploy.ts";
import type { Env } from "./env.ts";

// An "org:<slug>" model the organization registered; catalogue ids pass.
export const assertModelKnown = async (tx: Tx, model: string) => {
  if (!isOrgModel(model)) return;
  const [row] = await tx
    .select({ id: modelEndpoints.id })
    .from(modelEndpoints)
    .where(
      and(eq(modelEndpoints.model, model), eq(modelEndpoints.kind, "model")),
    );
  if (!row)
    throw new ApiError(
      422,
      "unknown_model",
      `The organization has no model ${model}. An Owner or Admin can register it under Models.`,
    );
};

export type ModelEndpointRow = typeof modelEndpoints.$inferSelect;

// What the runtime routes a model to: the endpoint's id for capture, the
// route itself, which never leaves the runtime's memory, and whether it serves
// an organization model or overrides a catalogue one. Every call to it
// carries no model charge (design doc 10).
export type RegisteredEndpoint = {
  id: string;
  url: string;
  key: string;
  model: string;
  kind: "override" | "model";
};

const aad = (organizationId: string, id: string) =>
  `${organizationId}|model_endpoint|${id}`;

export const sealKey = async (
  env: Env,
  tx: Tx,
  organizationId: string,
  id: string,
  key: string,
) => {
  const { version, key: dataKey } = await orgKey(env, tx, organizationId);
  return {
    keyVersion: version,
    keyCiphertext: await encrypt(dataKey, key, aad(organizationId, id)),
  };
};

export const openKey = async (
  env: Env,
  tx: Tx,
  row: Pick<
    ModelEndpointRow,
    "organizationId" | "id" | "keyVersion" | "keyCiphertext"
  >,
) => {
  if (row.keyVersion === null || row.keyCiphertext === null) return "";
  const dataKey = await orgKeyVersion(
    env,
    tx,
    row.organizationId,
    row.keyVersion,
  );
  return decrypt(dataKey, row.keyCiphertext, aad(row.organizationId, row.id));
};

// What still names an organization model, which keeps it from being deleted
// (design doc 10): a live deployment's code, an agent override, the
// organization default, or an eval suite with a run that has not finished.
export type ModelRef =
  | {
      type: "deployment";
      agentId: string;
      agentName: string;
      deploymentId: string;
      production: boolean;
    }
  | { type: "settings"; agentId: string; agentName: string }
  | { type: "organization_default" }
  | { type: "eval_suite"; suiteId: string; suiteName: string };

export const modelUsers = async (
  tx: Tx,
  model: string,
): Promise<ModelRef[]> => {
  const coded = await tx
    .select({
      id: deployments.id,
      agentId: deployments.agentId,
      agentName: agents.slug,
    })
    .from(deployments)
    .innerJoin(agents, eq(agents.id, deployments.agentId))
    .where(sql`${deployments.manifest}->>'model' = ${model}`)
    .orderBy(deployments.createdAt);
  const refs: ModelRef[] = [];
  for (const agentId of new Set(coded.map((d) => d.agentId))) {
    const live = new Set((await liveDeployments(tx, agentId)).map((d) => d.id));
    const [production] = await tx
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.agentId, agentId),
          isNotNull(deployments.promotedAt),
        ),
      )
      .orderBy(desc(deployments.promotedAt))
      .limit(1);
    for (const d of coded)
      if (d.agentId === agentId && live.has(d.id))
        refs.push({
          type: "deployment",
          agentId,
          agentName: d.agentName,
          deploymentId: d.id,
          production: d.id === production?.id,
        });
  }
  for (const a of await tx
    .select({ agentId: agents.id, agentName: agents.slug })
    .from(agentOverrides)
    .innerJoin(agents, eq(agents.id, agentOverrides.agentId))
    .where(sql`${agentOverrides.values}->>'model' = ${model}`))
    refs.push({ type: "settings", ...a });
  const [defaulted] = await tx
    .select({ organizationId: organizationDefaults.organizationId })
    .from(organizationDefaults)
    .where(sql`${organizationDefaults.values}->>'model' = ${model}`);
  if (defaulted) refs.push({ type: "organization_default" });
  for (const suite of await tx
    .selectDistinct({ suiteId: evalSuites.id, suiteName: evalSuites.name })
    .from(evalRuns)
    .innerJoin(evalSuites, eq(evalSuites.id, evalRuns.suiteId))
    .where(
      and(
        eq(evalRuns.model, model),
        inArray(evalRuns.status, ["queued", "running"]),
      ),
    ))
    refs.push({ type: "eval_suite", ...suite });
  return refs;
};

// How a refusal names a ref.
export const describeRef = (ref: ModelRef) =>
  ref.type === "deployment"
    ? `the ${ref.agentName} agent's ${ref.production ? "production" : "preview"} deployment ${ref.deploymentId}`
    : ref.type === "settings"
      ? `the ${ref.agentName} agent's settings`
      : ref.type === "organization_default"
        ? "the organization default"
        : `the eval suite ${ref.suiteName}`;

// Every endpoint the organization registered, by model, for the runtime at
// case start (Platform.modelEndpoints).
export const registeredEndpoints = (env: Env, organizationId: string) =>
  withOrg(env, orgId(organizationId), async (tx) => {
    const out: Record<string, RegisteredEndpoint> = {};
    for (const row of await tx.select().from(modelEndpoints))
      out[row.model] = {
        id: row.id,
        url: row.url,
        key: await openKey(env, tx, row),
        model: row.providerModel,
        kind: row.kind,
      };
    return out;
  });

// The install's own MODEL_ENDPOINTS entries (spec 16), by model.
export const installEndpoints = (env: Env): Set<string> => {
  if (!env.MODEL_ENDPOINTS) return new Set();
  try {
    return new Set(
      Object.keys(JSON.parse(env.MODEL_ENDPOINTS) as Record<string, unknown>),
    );
  } catch {
    return new Set();
  }
};
