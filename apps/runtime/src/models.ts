import {
  createModels,
  createProvider,
  type Model,
} from "@earendil-works/pi-ai";
import {
  stream,
  streamSimple,
} from "@earendil-works/pi-ai/api/openai-completions";
import { MODELS } from "@preprocess/sdk/protocol";

import type { Env } from "./env.ts";

export const PROVIDER = "preprocess";

type Stream = typeof stream;

// The agent models (spec 12a), served OpenAI-compatible by our model service,
// or the stub locally. MODEL_SERVICE_URL is the only thing that selects which
// (doc 07). Prices are on the Later list, so cost is zero here and token
// counts are what capture records.
// TODO(PRE-29): there is no AI Gateway provider seam yet. Models whose
// MODEL_CATALOG serving is "per-token" are to go through AI Gateway to
// Baseten's per-token model APIs, which name them by their own slugs; the rest,
// and every trained model, to the shared Baseten dedicated deployment for the
// base model, which picks the adapter by model name.
export const openModels = (env: Env, observe: (fn: Stream) => Stream) => {
  if (!env.MODEL_SERVICE_URL)
    throw new Error("model_unavailable: MODEL_SERVICE_URL is unset");
  const baseUrl = new URL("/v1", env.MODEL_SERVICE_URL).toString();
  const models: Model<"openai-completions">[] = MODELS.map((id) => ({
    id,
    name: id,
    api: "openai-completions",
    provider: PROVIDER,
    baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 8192,
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: true },
  }));
  const registry = createModels();
  registry.setProvider(
    createProvider({
      id: PROVIDER,
      name: "Preprocess models",
      baseUrl,
      auth: {
        apiKey: {
          name: "Preprocess",
          resolve: () =>
            Promise.resolve({ auth: { apiKey: env.MODEL_SERVICE_KEY ?? "" } }),
        },
      },
      models,
      api: {
        stream: observe(stream),
        streamSimple: observe(
          streamSimple as unknown as Stream,
        ) as unknown as typeof streamSimple,
      },
    }),
  );
  return registry;
};
