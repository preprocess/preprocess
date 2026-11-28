// Organization endpoints (design doc 10): an org:<slug> model is served only
// by its registered endpoint, and every call to an organization's own
// endpoint carries no model charge, whatever its base model or the model name
// its response carries. Calls through our providers keep the catalogue price.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { Env, RegisteredEndpoint } from "../src/env.ts";
import { modelCost, openModels, PROVIDER } from "../src/models.ts";

const cloud = { ...env, PREPROCESS_REGION: "us" } as Env;
const FREE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const endpoint = (
  over: Partial<RegisteredEndpoint> = {},
): RegisteredEndpoint => ({
  id: "mep_1",
  url: env.MODEL_SERVICE_URL!,
  key: env.MODEL_SERVICE_KEY ?? "",
  model: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  kind: "model",
  ...over,
});

describe("organization models", () => {
  it("charges nothing for a model served by the organization's endpoint", () => {
    const models = openModels(cloud, (fn) => fn, {
      "org:invoices-v2": endpoint(),
      "qwen3.8-27b": endpoint({ id: "mep_3", kind: "override" }),
    });
    expect(models.getModel(PROVIDER, "org:invoices-v2")?.cost).toEqual(FREE);
    expect(models.getModel(PROVIDER, "qwen3.8-27b")?.cost).toEqual(FREE);
    // The same catalogue models through our providers keep their price.
    expect(models.getModel(PROVIDER, "kimi-k3.1-pro")?.cost).toEqual(
      modelCost(cloud, "kimi-k3.1-pro"),
    );
    expect(
      openModels(cloud, (fn) => fn).getModel(PROVIDER, "qwen3.8-27b")?.cost,
    ).toEqual(modelCost(cloud, "qwen3.8-27b"));
    expect(modelCost(cloud, "qwen3.8-27b").input).toBeGreaterThan(0);
  });

  it("meters no model charge on an endpoint's responses, even one named like a catalogue model", async () => {
    // The Fast override's endpoint answers as the base DeepSeek model, which
    // on Baseten would mean "billed at base rates"; here it must stay free.
    const models = openModels(cloud, (fn) => fn, {
      "org:invoices-v2": endpoint(),
      "deepseek-v4.1-flash-fast": endpoint({ id: "mep_4", kind: "override" }),
    });
    const ask = (id: string) =>
      models.completeSimple(models.getModel(PROVIDER, id)!, {
        messages: [{ role: "user", content: "hello", timestamp: 1 }],
      });
    const own = await ask("org:invoices-v2");
    const fast = await ask("deepseek-v4.1-flash-fast");
    const provider = await ask("deepseek-v4.1-flash");
    for (const reply of [own, fast, provider]) {
      expect(reply.stopReason).not.toBe("error");
      expect(reply.usage.input).toBeGreaterThan(0);
    }
    expect(fast.responseModel).toBe("deepseek-ai/DeepSeek-V4.1-Flash-1017");
    expect(own.usage.cost.total).toBe(0);
    expect(fast.usage.cost.total).toBe(0);
    expect(provider.usage.cost.total).toBeGreaterThan(0);
  });

  it("knows only the organization models it was given", async () => {
    expect(
      openModels(env, (fn) => fn).getModel(PROVIDER, "org:invoices-v2"),
    ).toBeUndefined();
    const models = openModels(env, (fn) => fn, {
      "org:invoices-v2": endpoint(),
      // An override row never makes a model of its own.
      "org:stray": endpoint({ kind: "override" }),
    });
    expect(models.getModel(PROVIDER, "org:stray")).toBeUndefined();
    const model = models.getModel(PROVIDER, "org:invoices-v2")!;
    const reply = await models.completeSimple(model, {
      messages: [{ role: "user", content: "hello", timestamp: 1 }],
    });
    expect(reply.stopReason).not.toBe("error");
  });
});
