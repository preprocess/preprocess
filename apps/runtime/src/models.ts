import {
  createModels,
  createProvider,
  type Model,
} from "@earendil-works/pi-ai";
import {
  stream,
  streamSimple,
} from "@earendil-works/pi-ai/api/openai-completions";
import {
  modelRoute,
  type ModelRoute,
  ROUTES,
} from "@preprocess/models/endpoints";
import { MARKUP } from "@preprocess/models/prices";
import { runMode } from "@preprocess/runmode";
import { MODELS, type Model as AgentModel } from "@preprocess/sdk/protocol";

import type { Env } from "./env.ts";

export const PROVIDER = "preprocess";

type Stream = typeof stream;

// List prices in USD per million tokens. Baseten's Model APIs
// (baseten.co/pricing, read 2026-11-26) charge nothing for cache writes;
// Workers AI's price is on the model's page
// (developers.cloudflare.com/workers-ai/models/qwen3.8-27b, read 2026-11-26).
const LIST: Record<
  AgentModel,
  { input: number; cacheRead: number; output: number }
> = {
  // Baseten "Kimi K3.1 Pro": $2.00 in, $0.20 cached in, $10.00 out.
  "kimi-k3.1-pro": { input: 2, cacheRead: 0.2, output: 10 },
  // Baseten "DeepSeek V4.1 Flash 1017": $0.30 in, $0.007 cached in, $1.20 out.
  "deepseek-v4.1-flash": { input: 0.3, cacheRead: 0.007, output: 1.2 },
  // Baseten "DeepSeek V4.1 Flash 1017 Fast": $0.60 in, $0.014 cached in,
  // $2.40 out.
  "deepseek-v4.1-flash-fast": { input: 0.6, cacheRead: 0.014, output: 2.4 },
  // Workers AI "@cf/qwen/qwen3.8-27b": $0.45 in, $0.05 cached in, $3.20 out.
  "qwen3.8-27b": { input: 0.45, cacheRead: 0.05, output: 3.2 },
};

// What a case pays per million tokens (spec 16a): the provider's list price
// plus 5%. Only our cloud charges; a self-hosted install calls its own
// providers and serving URLs, so it is free.
export const modelCost = (env: Env, id: AgentModel) => {
  if (runMode(env).kind !== "cloud")
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const list = LIST[id];
  return {
    input: list.input * MARKUP,
    output: list.output * MARKUP,
    cacheRead: list.cacheRead * MARKUP,
    cacheWrite: 0,
  };
};

// The model a response was billed as. Baseten serves a Fast request from base
// capacity when Fast capacity is short and bills it at the base model's rates
// (docs.baseten.co/inference/model-apis/pricing-and-limits); the response
// names the model that served it.
export const billedAs = (id: AgentModel, responseModel?: string): AgentModel =>
  id === "deepseek-v4.1-flash-fast" &&
  responseModel === ROUTES["deepseek-v4.1-flash"].model
    ? "deepseek-v4.1-flash"
    : id;

type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

const reprice = (usage: Usage, rates: ReturnType<typeof modelCost>) => {
  const part = (tokens: number, rate: number) => (tokens / 1_000_000) * rate;
  usage.cost.input = part(usage.input, rates.input);
  usage.cost.output = part(usage.output, rates.output);
  usage.cost.cacheRead = part(usage.cacheRead, rates.cacheRead);
  usage.cost.cacheWrite = part(usage.cacheWrite, rates.cacheWrite);
  usage.cost.total =
    usage.cost.input +
    usage.cost.output +
    usage.cost.cacheRead +
    usage.cost.cacheWrite;
};

// Workers AI takes reasoning_effort low, medium or xhigh.
const workersAiEffort: Record<string, string> = { high: "xhigh" };

// The OpenAI client's fetch for one model: the request goes to the model's
// route under the provider's own model name. Qwen runs through the Workers AI
// binding, which speaks the same chat-completions shape.
export const routeFetch =
  (env: Env, route: ModelRoute | undefined): typeof fetch =>
  async (input, init) => {
    if (!route)
      return Response.json(
        { error: { message: "No such model" } },
        { status: 404 },
      );
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    body.model = route.model;
    if ("binding" in route) {
      if (typeof body.reasoning_effort === "string")
        body.reasoning_effort =
          workersAiEffort[body.reasoning_effort] ?? body.reasoning_effort;
      const { model, ...inputs } = body;
      try {
        return (await env.AI!.run(
          model as keyof AiModels,
          inputs as never,
          {
            returnRawResponse: true,
            signal: init?.signal ?? undefined,
          } as AiOptions,
        )) as unknown as Response;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json(
          { error: { message: `Workers AI: ${message}` } },
          { status: /rate.?limit|capacity/i.test(message) ? 429 : 502 },
        );
      }
    }
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${route.key}`);
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    return fetch(new URL(path.slice(path.indexOf("/v1/")), route.url), {
      ...init,
      headers,
      body: JSON.stringify(body),
    });
  };

// The agent models (spec 3), each routed on its own (packages/models
// endpoints): Kimi and DeepSeek to Baseten, Qwen to Workers AI, or the stub
// through MODEL_SERVICE_URL. pi-ai prices each response from `cost`; a Fast
// request served from base capacity is repriced at base rates before capture
// records it.
export const openModels = (env: Env, observe: (fn: Stream) => Stream) => {
  const routes = new Map(MODELS.map((id) => [id, modelRoute(env, id)]));
  const models: Model<"openai-completions">[] = MODELS.map((id) => {
    const route = routes.get(id)!;
    return {
      id,
      name: id,
      api: "openai-completions",
      provider: PROVIDER,
      baseUrl:
        "binding" in route
          ? "https://workers-ai.binding/v1"
          : new URL("/v1", route.url).toString(),
      reasoning: true,
      input: ["text"],
      cost: modelCost(env, id),
      contextWindow: 262144,
      maxTokens: 8192,
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: true },
    };
  });
  // Every call goes through its model's route. A Fast request's usage is
  // repriced before anything else reads the result: this reaction is
  // registered first, so capture records the corrected cost.
  const routed = <F extends Stream>(fn: F) =>
    ((model, context, options) => {
      const id = model.id as AgentModel;
      const events = fn(model, context, {
        ...options,
        fetch: routeFetch(env, routes.get(id)),
      });
      void events.result().then((message) => {
        const served = billedAs(id, message.responseModel);
        if (served !== id) reprice(message.usage, modelCost(env, served));
      });
      return events;
    }) as F;
  const registry = createModels();
  registry.setProvider(
    createProvider({
      id: PROVIDER,
      name: "Preprocess models",
      baseUrl: models[0]!.baseUrl,
      auth: {
        apiKey: {
          name: "Preprocess",
          resolve: () => Promise.resolve({ auth: { apiKey: "routed" } }),
        },
      },
      models,
      api: {
        stream: observe(routed(stream)),
        streamSimple: observe(
          routed(streamSimple as unknown as Stream),
        ) as unknown as typeof streamSimple,
      },
    }),
  );
  return registry;
};
