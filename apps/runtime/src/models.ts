import {
  createModels,
  createProvider,
  type Model,
} from "@earendil-works/pi-ai";
import {
  stream,
  streamSimple,
} from "@earendil-works/pi-ai/api/openai-completions";
import { MARKUP } from "@preprocess/models/prices";
import { runMode } from "@preprocess/runmode";
import { MODELS, type Model as AgentModel } from "@preprocess/sdk/protocol";

import type { Env } from "./env.ts";

export const PROVIDER = "preprocess";

type Stream = typeof stream;

// Baseten's Model APIs list prices in USD per million tokens
// (baseten.co/pricing, read 2026-11-26). Baseten charges nothing for cache
// writes.
const BASETEN: Record<
  AgentModel,
  { input: number; cacheRead: number; output: number }
> = {
  // "Kimi K3.1 Pro": $2.00 in, $0.20 cached in, $10.00 out.
  "kimi-k3.1-pro": { input: 2, cacheRead: 0.2, output: 10 },
  // "DeepSeek V4.1 Flash": $0.30 in, $0.007 cached in, $1.20 out.
  "deepseek-v4.1-flash": { input: 0.3, cacheRead: 0.007, output: 1.2 },
  // "DeepSeek V4.1 Flash Fast": $0.60 in, $0.014 cached in, $2.40 out.
  "deepseek-v4.1-flash-fast": { input: 0.6, cacheRead: 0.014, output: 2.4 },
  // No serverless price: priced as DeepSeek V4.1 Flash (spec 16a).
  "qwen3.8-27b": { input: 0.3, cacheRead: 0.007, output: 1.2 },
};

// What a case pays per million tokens (spec 16a): Baseten's serverless price
// plus 5%, trained models at their base model's price. Only our cloud charges;
// on a self-hosted install the model URL is the install's own, so it is free.
export const modelCost = (env: Env, id: AgentModel) => {
  if (runMode(env).kind !== "cloud")
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const list = BASETEN[id];
  return {
    input: list.input * MARKUP,
    output: list.output * MARKUP,
    cacheRead: list.cacheRead * MARKUP,
    cacheWrite: 0,
  };
};

// The agent models (spec 12a), served OpenAI-compatible by our model service,
// or the stub locally. MODEL_SERVICE_URL is the only thing that selects which
// (doc 07). pi-ai prices each response from `cost`, and capture records it.
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
    cost: modelCost(env, id),
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
