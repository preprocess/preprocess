import { type ModelEndpoint, ModelError } from "./client.ts";

// Where each model is served (spec 3 and 16a). Kimi, DeepSeek and the
// decision model are Baseten's per-token Model APIs, Qwen is Cloudflare
// Workers AI in the install's own account, and OCR is Mistral's global API.
// `model` is the provider's own name for it, sent on every request, pinned to
// a dated snapshot where the provider has one: DeepSeek's -1017 rather than
// the moving name. groundhog-1 exists only as its "latest" alias.
export const ROUTES = {
  "kimi-k3.1-pro": { provider: "baseten", model: "moonshotai/Kimi-K3.1-Pro" },
  "deepseek-v4.1-flash": {
    provider: "baseten",
    model: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  },
  "deepseek-v4.1-flash-fast": {
    provider: "baseten",
    model: "deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast",
  },
  "qwen3.8-27b": { provider: "workers-ai", model: "@cf/qwen/qwen3.8-27b" },
  decide: {
    provider: "baseten",
    model: "decision-models/baseten-groundhog-latest",
  },
  ocr: { provider: "mistral", model: "mistral-ocr-4-1" },
} as const;

export type RoutedModel = keyof typeof ROUTES;

const PROVIDERS = {
  baseten: { url: "https://inference.baseten.co", key: "BASETEN_API_KEY" },
  mistral: { url: "https://api.mistral.ai", key: "MISTRAL_API_KEY" },
} as const;

export type ModelServiceEnv = {
  BASETEN_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  // The Workers AI binding, which serves Qwen.
  AI?: unknown;
  // Per-model endpoints, JSON: { "<model>": { url, key?, model? } }, for a
  // self-hosted install's own serving URLs (spec 16).
  MODEL_ENDPOINTS?: string;
  // One OpenAI- and System One-compatible service for every model nothing
  // else serves: the stub in development, previews and tests (doc 07).
  MODEL_SERVICE_URL?: string;
  MODEL_SERVICE_KEY?: string;
};

export type ModelRoute = ModelEndpoint | { binding: "AI"; model: string };

const ownEndpoint = (env: ModelServiceEnv, name: RoutedModel) => {
  if (!env.MODEL_ENDPOINTS) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.MODEL_ENDPOINTS);
  } catch {
    throw new ModelError("model_unavailable", "MODEL_ENDPOINTS is not JSON");
  }
  const own = (parsed as Record<string, unknown>)[name] as
    { url?: unknown; key?: unknown; model?: unknown } | undefined;
  if (!own) return undefined;
  if (typeof own.url !== "string")
    throw new ModelError(
      "model_unavailable",
      `MODEL_ENDPOINTS.${name} needs a url`,
    );
  return {
    url: own.url,
    key: typeof own.key === "string" ? own.key : "",
    model: typeof own.model === "string" ? own.model : ROUTES[name].model,
  };
};

// The one resolver, per model: the organization's registered endpoint (the
// caller looks it up), then the install's MODEL_ENDPOINTS entry, then the
// model's provider when its key or binding is there, then MODEL_SERVICE_URL.
// With none of them the model is unavailable; there is no other fallback.
export function modelRoute(
  env: ModelServiceEnv,
  name: RoutedModel,
  registered?: ModelEndpoint | null,
): ModelRoute {
  if (registered) return registered;
  const own = ownEndpoint(env, name);
  if (own) return own;
  const route = ROUTES[name];
  if (route.provider === "workers-ai") {
    if (env.AI) return { binding: "AI", model: route.model };
  } else {
    const provider = PROVIDERS[route.provider];
    const key = env[provider.key];
    if (key) return { url: provider.url, key, model: route.model };
  }
  if (env.MODEL_SERVICE_URL)
    return {
      url: env.MODEL_SERVICE_URL,
      key: env.MODEL_SERVICE_KEY ?? "",
      model: route.model,
    };
  throw new ModelError(
    "model_unavailable",
    `No model service is configured for ${name}: set ${route.provider === "workers-ai" ? "the AI binding" : PROVIDERS[route.provider].key}, an entry in MODEL_ENDPOINTS or MODEL_SERVICE_URL, or register an endpoint for the organization`,
  );
}

// decide and OCR, which are always called over HTTP.
export function modelEndpoint(
  env: ModelServiceEnv,
  name: "decide" | "ocr",
  registered?: ModelEndpoint | null,
): ModelEndpoint {
  const route = modelRoute(env, name, registered);
  if ("binding" in route)
    throw new ModelError("model_unavailable", `${name} has no binding route`);
  return route;
}
