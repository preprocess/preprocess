// The allowed-models guardrail (spec 5): the catalogue models an Owner or
// Admin lets agents run on. Unset allows every model. It is checked wherever
// a model is chosen or resolved: deploys, settings, case starts, eval runs and
// approval decisions.

import { audit } from "@preprocess/db/audit";
import type { Tx } from "@preprocess/db/client";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { organizationGuardrails } from "@preprocess/db/schema/guardrails";
import { currentModel, MODEL_CATALOG } from "@preprocess/sdk/protocol";
import { eq } from "drizzle-orm";

import { actor, eventBase } from "./caller.ts";
import type { OrgVariables } from "./caller.ts";
import { ApiError } from "./cases.ts";
import type { Manifest } from "./deploy.ts";
import { assertModelKnown } from "./model-endpoints.ts";
import { effectiveSettings } from "./settings.ts";

// Runs in the organization's transaction.
export const allowedModels = async (tx: Tx): Promise<string[] | null> =>
  (
    await tx
      .select({ models: organizationGuardrails.allowedModels })
      .from(organizationGuardrails)
  )[0]?.models ?? null;

export const modelAllowed = (
  allowed: readonly string[] | null,
  model: string,
) => allowed === null || allowed.includes(currentModel(model));

const label = (model: string) =>
  MODEL_CATALOG[model as keyof typeof MODEL_CATALOG]?.label ?? model;

// The model exists (an organization model must be registered) and the
// guardrail allows it.
export const assertModelAllowed = async (tx: Tx, model: string) => {
  await assertModelKnown(tx, currentModel(model));
  if (modelAllowed(await allowedModels(tx), model)) return;
  const id = currentModel(model);
  throw new ApiError(
    409,
    "model_not_allowed",
    `The organization does not allow the model ${label(id)} (${id}). An Owner or Admin can allow it in Guardrails.`,
  );
};

// The model a case runs on when it runs again (a rerun or an approval).
export const assertCaseModelAllowed = async (tx: Tx, caseId: string) => {
  const [found] = await tx
    .select({ agentId: cases.agentId, manifest: deployments.manifest })
    .from(cases)
    .innerJoin(deployments, eq(deployments.id, cases.deploymentId))
    .where(eq(cases.id, caseId));
  if (!found) return;
  const { model } = await effectiveSettings(
    tx,
    found.agentId,
    found.manifest as Manifest,
  );
  await assertModelAllowed(tx, model);
};

// An Owner or Admin's change is the approval (spec 5). Returns whether the
// list changed.
export const setAllowedModels = async (
  tx: Tx,
  vars: OrgVariables,
  models: string[] | null,
) => {
  for (const model of models ?? []) await assertModelKnown(tx, model);
  const before = await allowedModels(tx);
  const after = models && [...new Set(models)].sort();
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  const updatedBy = actor(vars.caller).actorId;
  await tx
    .insert(organizationGuardrails)
    .values({ organizationId: vars.org, allowedModels: after, updatedBy })
    .onConflictDoUpdate({
      target: organizationGuardrails.organizationId,
      set: { allowedModels: after, updatedBy, updatedAt: new Date() },
    });
  await audit(tx, {
    ...eventBase(vars),
    action: "guardrail.updated",
    targetType: "organization",
    targetId: vars.org,
    data: { guardrail: "allowed_models", before, after },
  });
  return true;
};
