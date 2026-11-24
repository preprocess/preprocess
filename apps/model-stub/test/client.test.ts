import { ModelError } from "@preprocess/models/client";
import { models } from "@preprocess/models/contract";
import { decide } from "@preprocess/models/decide";
import { modelEndpoint } from "@preprocess/models/endpoints";
import { ocrPage, parseGrounding } from "@preprocess/models/ocr";
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

describe("modelEndpoint", () => {
  it("uses MODEL_SERVICE_URL and MODEL_SERVICE_KEY with the purpose's model", () => {
    expect(
      modelEndpoint(
        { MODEL_SERVICE_URL: "https://m.test", MODEL_SERVICE_KEY: "k" },
        "ocr",
      ),
    ).toEqual({ url: "https://m.test", key: "k", model: models.ocr });
  });

  it("prefers the organization's registered endpoint", () => {
    const own = { url: "https://own.test", key: "own", model: "custom" };
    expect(
      modelEndpoint(
        { MODEL_SERVICE_URL: "https://m.test", MODEL_SERVICE_KEY: "k" },
        "decide",
        own,
      ),
    ).toBe(own);
  });

  it("is model_unavailable (503) with nothing configured, never a fallback", () => {
    let error: unknown;
    try {
      modelEndpoint({}, "decide");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ModelError);
    expect(error).toMatchObject({ code: "model_unavailable", status: 503 });
  });
});

describe("decide against the stub", () => {
  const groundhog = endpoint(models.decide);

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
  const lighton = endpoint(models.ocr);

  it("reads a sample page as Markdown", async () => {
    const page = await ocrPage(lighton, { image: sample }, { fetcher: stub() });
    expect(page.markdown).toBe(acmeInvoice.markdown);
    expect(page.blocks).toBeUndefined();
    expect(page.usage.model).toBe("stub-lightonocr");
  });

  it("reads labelled blocks in grounding mode", async () => {
    const page = await ocrPage(
      lighton,
      { image: sample, grounding: true },
      { fetcher: stub() },
    );
    expect(page.blocks).toEqual(acmeInvoice.blocks);
    expect(page.markdown).toContain("# Acme Corporation");
  });

  it("returns a placeholder for an unknown page", async () => {
    const page = await ocrPage(
      lighton,
      {
        image:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
        grounding: true,
      },
      { fetcher: stub() },
    );
    expect(page.markdown).toMatch(/^# Stub OCR/);
    expect(page.blocks).toHaveLength(1);
    expect(page.blocks?.[0]?.bbox).toEqual([0, 0, 1000, 1000]);
  });

  it("answers vLLM's 404 for another model and 400 for a remote image", async () => {
    expect(
      (
        await rejection(
          ocrPage(endpoint("other"), { image: sample }, { fetcher: stub() }),
        )
      ).message,
    ).toContain("404");
    const response = await post("/v1/chat/completions", {
      model: models.ocr,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "https://x.test/p.png" } },
            { type: "text", text: "" },
          ],
        },
      ],
    });
    expect(response.status).toBe(400);
  });

  it("keeps text outside a malformed grounding marker out of the blocks", () => {
    const parsed = parseGrounding(
      '<|block|>{"label":"text","bbox":[1,2,3,4]}\nHello\n\n<|block|>not json\nLost',
    );
    expect(parsed.blocks).toEqual([
      { label: "text", bbox: [1, 2, 3, 4], text: "Hello" },
    ]);
  });
});

describe("model service failures", () => {
  const groundhog = endpoint(models.decide);
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
