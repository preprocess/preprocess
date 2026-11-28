// Organization models (design doc 10): an org:<slug> model is served only by
// its registered endpoint and priced at its base model's rates, or at zero
// without one; a catalogue override keeps the catalogue price.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { Env, RegisteredEndpoint } from "../src/env.ts";
import { modelCost, openModels, PROVIDER } from "../src/models.ts";

const cloud = { ...env, PREPROCESS_REGION: "us" } as Env;

const endpoint = (
  over: Partial<RegisteredEndpoint> = {},
): RegisteredEndpoint => ({
  id: "mep_1",
  url: env.MODEL_SERVICE_URL!,
  key: env.MODEL_SERVICE_KEY ?? "",
  model: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  kind: "model",
  baseModel: "kimi-k3.1-pro",
  ...over,
});

describe("organization models", () => {
  it("prices one at its base model's rates, and at zero without one", () => {
    const models = openModels(cloud, (fn) => fn, {
      "org:invoices-v2": endpoint(),
      "org:raw": endpoint({ id: "mep_2", baseModel: null }),
      "qwen3.8-27b": endpoint({ id: "mep_3", kind: "override" }),
    });
    expect(models.getModel(PROVIDER, "org:invoices-v2")?.cost).toEqual(
      modelCost(cloud, "kimi-k3.1-pro"),
    );
    expect(models.getModel(PROVIDER, "org:raw")?.cost).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(models.getModel(PROVIDER, "qwen3.8-27b")?.cost).toEqual(
      modelCost(cloud, "qwen3.8-27b"),
    );
    expect(modelCost(cloud, "kimi-k3.1-pro").input).toBeGreaterThan(0);
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
