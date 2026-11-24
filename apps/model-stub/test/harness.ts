import type { ModelEndpoint } from "@preprocess/models/client";
import { exports } from "cloudflare:workers";

// The model client calls the stub Worker in this test runtime exactly as it
// calls any model service over HTTP. Only the harness sets the stub's control
// headers (x-stub-fail, x-stub-latency-ms).
export const stub = (headers: Record<string, string> = {}) => ({
  fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    for (const [name, value] of Object.entries(headers))
      request.headers.set(name, value);
    return exports.default.fetch(request);
  }) as typeof fetch,
});

export const endpoint = (model: string): ModelEndpoint => ({
  url: "https://model-stub.test",
  key: "test",
  model,
});

export const post = (path: string, body: unknown, token = "test") =>
  exports.default.fetch(
    new Request(`https://model-stub.test${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
