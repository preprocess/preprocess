import { type ModelEndpoint, ModelError } from "./client.ts";
import { models } from "./contract.ts";

export type ModelPurpose = keyof typeof models;

export type ModelServiceEnv = {
  MODEL_SERVICE_URL?: string;
  MODEL_SERVICE_KEY?: string;
};

// The one resolver (design doc 07). An organization's registered endpoint for
// this purpose (self-hosted "Model endpoints") wins; the caller looks it up and
// passes it. Otherwise the install's MODEL_SERVICE_URL and MODEL_SERVICE_KEY.
// The stub is chosen only by pointing that URL at it: there is no fallback.
export function modelEndpoint(
  env: ModelServiceEnv,
  purpose: ModelPurpose,
  registered?: ModelEndpoint | null,
): ModelEndpoint {
  if (registered) return registered;
  if (!env.MODEL_SERVICE_URL || !env.MODEL_SERVICE_KEY)
    throw new ModelError(
      "model_unavailable",
      `No model service is configured for ${purpose}: set MODEL_SERVICE_URL and MODEL_SERVICE_KEY, or register an endpoint for the organization`,
    );
  return {
    url: env.MODEL_SERVICE_URL,
    key: env.MODEL_SERVICE_KEY,
    model: models[purpose],
  };
}
