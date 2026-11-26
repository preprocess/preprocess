import { ModelError } from "@preprocess/models/client";
import { decide } from "@preprocess/models/decide";
import {
  modelEndpoint,
  modelRoute,
  ROUTES,
} from "@preprocess/models/endpoints";
import { ocrDocument } from "@preprocess/models/ocr";
import { describe, expect, it } from "vitest";

import acmeInvoice from "../fixtures/ocr/2d95a627992d4708970bc90604baef4d1c95de4f3ab61d9769a350d0a51f0a7a.json";
import sample from "../fixtures/ocr/samples/acme-invoice.png?inline";
import { endpoint, post, stub } from "./harness.ts";

const vendors = [
  { id: "acme", label: "Acme Corporation" },
  { id: "globex", label: "Globex", description: "Industrial supplies" },
  { id: "initech", label: "Initech", description: "Software and printers" },
  { id: "northwind", label: "Northwind Traders", description: "Food" },
];

const rejection = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ModelError);
  return error as ModelError;
};

describe("modelRoute", () => {
  const stubService = {
    MODEL_SERVICE_URL: "https://m.test",
    MODEL_SERVICE_KEY: "k",
  };

  it("routes each model to its provider when its key or binding is set", () => {
    const env = { BASETEN_API_KEY: "b", MISTRAL_API_KEY: "m", AI: {} };
    expect(modelRoute(env, "kimi-k3.1-pro")).toEqual({
      url: "https://inference.baseten.co",
      key: "b",
      model: "moonshotai/Kimi-K3.1-Pro",
    });
    expect(modelEndpoint(env, "decide")).toEqual({
      url: "https://inference.baseten.co",
      key: "b",
      model: "decision-models/baseten-groundhog-latest",
    });
    expect(modelEndpoint(env, "ocr")).toEqual({
      url: "https://api.mistral.ai",
      key: "m",
      model: "mistral-ocr-4-1",
    });
    expect(modelRoute(env, "qwen3.8-27b")).toEqual({
      binding: "AI",
      model: "@cf/qwen/qwen3.8-27b",
    });
  });

  it("sends models without a provider to MODEL_SERVICE_URL", () => {
    expect(
      modelRoute({ ...stubService, AI: {} }, "deepseek-v4.1-flash"),
    ).toEqual({
      url: "https://m.test",
      key: "k",
      model: ROUTES["deepseek-v4.1-flash"].model,
    });
    expect(modelEndpoint(stubService, "ocr")).toEqual({
      url: "https://m.test",
      key: "k",
      model: ROUTES.ocr.model,
    });
    expect(modelRoute(stubService, "qwen3.8-27b")).toMatchObject({
      url: "https://m.test",
    });
  });

  it("prefers the install's MODEL_ENDPOINTS entry over the provider", () => {
    const env = {
      MISTRAL_API_KEY: "m",
      MODEL_ENDPOINTS: JSON.stringify({
        ocr: { url: "https://ocr.own.test", key: "own" },
      }),
    };
    expect(modelEndpoint(env, "ocr")).toEqual({
      url: "https://ocr.own.test",
      key: "own",
      model: ROUTES.ocr.model,
    });
  });

  it("prefers the organization's registered endpoint", () => {
    const own = { url: "https://own.test", key: "own", model: "custom" };
    expect(
      modelEndpoint({ ...stubService, BASETEN_API_KEY: "b" }, "decide", own),
    ).toBe(own);
  });

  it("is model_unavailable (503) with nothing configured, never a fallback", () => {
    let error: unknown;
    try {
      modelEndpoint({ BASETEN_API_KEY: "b" }, "ocr");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ModelError);
    expect(error).toMatchObject({ code: "model_unavailable", status: 503 });
  });
});

describe("decide against the stub", () => {
  const groundhog = endpoint(ROUTES.decide.model);

  it("returns the top pick and its probability", async () => {
    const result = await decide(
      groundhog,
      {
        prompt: "Which vendor sent this invoice?",
        case: { input: "Invoice 1042 from Acme Corporation" },
        options: vendors,
      },
      { fetcher: stub() },
    );
    expect(result.picks).toEqual([{ id: "acme", probability: 0.93 }]);
    expect(result.usage).toMatchObject({
      model: "stub-groundhog",
      requests: 1,
    });
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it("returns the n most probable with keep", async () => {
    const result = await decide(
      groundhog,
      {
        prompt: "Which vendor sells software?",
        options: vendors,
        keep: 3,
      },
      { fetcher: stub() },
    );
    expect(result.picks).toHaveLength(3);
    expect(result.picks[0]?.id).toBe("initech");
    const p = result.picks.map((pick) => pick.probability);
    expect(p).toEqual([...p].sort((a, b) => b - a));
  });

  it("decides lists over 255 options in parallel rounds", async () => {
    const options = Array.from({ length: 600 }, (_, i) => ({
      id: `account_${i}`,
      label: `Account ${i}`,
    }));
    options[431] = {
      id: "account_431",
      label: "Freight and shipping",
    };
    const result = await decide(
      groundhog,
      { prompt: "Which account books freight shipping?", options, keep: 2 },
      { fetcher: stub() },
    );
    // Three chunks of at most 255, then one final round over the survivors.
    expect(result.usage.requests).toBe(4);
    expect(result.picks[0]?.id).toBe("account_431");
    expect(result.picks).toHaveLength(2);
  });

  it("rejects duplicate ids and an out-of-range keep before calling", async () => {
    const fetcher = {
      fetch: (() => {
        throw new Error("should not be called");
      }) as typeof fetch,
    };
    expect(
      (
        await rejection(
          decide(
            groundhog,
            { prompt: "x", options: [vendors[0]!, vendors[0]!] },
            { fetcher },
          ),
        )
      ).code,
    ).toBe("invalid_request");
    expect(
      (
        await rejection(
          decide(
            groundhog,
            { prompt: "x", options: vendors, keep: 0 },
            { fetcher },
          ),
        )
      ).code,
    ).toBe("invalid_request");
  });
});

describe("OCR against the stub", () => {
  const mistral = endpoint(ROUTES.ocr.model);
  const blank =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==";

  it("reads a sample page as Markdown", async () => {
    const read = await ocrDocument(
      mistral,
      { document: sample },
      { fetcher: stub() },
    );
    expect(read.pages).toEqual([{ index: 0, markdown: acmeInvoice.markdown }]);
    expect(read.usage).toEqual({ model: "stub-mistral-ocr", pages: 1 });
  });

  it("reads labelled blocks in grounding mode", async () => {
    const read = await ocrDocument(
      mistral,
      { document: sample, grounding: true },
      { fetcher: stub() },
    );
    expect(read.pages[0]?.blocks).toEqual(acmeInvoice.blocks);
    expect(read.pages[0]?.markdown).toContain("# Acme Corporation");
  });

  it("sends a PDF as a document and reads every page", async () => {
    const pdf = `data:application/pdf;base64,${btoa(
      "%PDF-1.7 /Type /Pages /Type /Page /Type /Page",
    )}`;
    const read = await ocrDocument(
      mistral,
      { document: pdf },
      { fetcher: stub() },
    );
    expect(read.pages.map((page) => page.index)).toEqual([0, 1]);
    expect(read.usage.pages).toBe(2);
  });

  it("returns a placeholder for an unknown page", async () => {
    const read = await ocrDocument(
      mistral,
      { document: blank, grounding: true },
      { fetcher: stub() },
    );
    expect(read.pages[0]?.markdown).toMatch(/^# Stub OCR/);
    expect(read.pages[0]?.blocks).toHaveLength(1);
    expect(read.pages[0]?.blocks?.[0]?.bbox).toEqual([0, 0, 1000, 1000]);
  });

  it("refuses another model and a remote document", async () => {
    expect(
      (
        await rejection(
          ocrDocument(
            endpoint("other"),
            { document: sample },
            { fetcher: stub() },
          ),
        )
      ).code,
    ).toBe("invalid_request");
    const response = await post("/v1/ocr", {
      model: ROUTES.ocr.model,
      document: { type: "document_url", document_url: "https://x.test/p.pdf" },
    });
    expect(response.status).toBe(422);
  });
});

describe("model service failures", () => {
  const groundhog = endpoint(ROUTES.decide.model);
  const ask = (headers: Record<string, string>, timeoutMs?: number) =>
    rejection(
      decide(
        groundhog,
        { prompt: "x", options: vendors },
        { fetcher: stub(headers), ...(timeoutMs && { timeoutMs }) },
      ),
    );

  it.each([
    ["429", "rate_limited", 429],
    ["500", "upstream_error", 502],
    ["503", "upstream_error", 502],
  ])("maps x-stub-fail %s to %s", async (fail, code, status) => {
    expect(await ask({ "x-stub-fail": fail })).toMatchObject({ code, status });
  });

  it("times out", async () => {
    expect(await ask({ "x-stub-fail": "timeout" }, 200)).toMatchObject({
      code: "timeout",
      status: 504,
    });
  });

  it("adds latency on request", async () => {
    const started = Date.now();
    await decide(
      groundhog,
      { prompt: "x", options: vendors },
      { fetcher: stub({ "x-stub-latency-ms": "150" }) },
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });

  it("is model_unavailable without a bearer token's acceptance", async () => {
    expect(
      await rejection(
        decide(
          { ...groundhog, key: "" },
          { prompt: "x", options: vendors },
          { fetcher: stub() },
        ),
      ),
    ).toMatchObject({ code: "model_unavailable" });
  });
});
