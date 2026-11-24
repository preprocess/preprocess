import type { z } from "zod";

export type ModelEndpoint = { url: string; key: string; model: string };

export type ModelErrorCode =
  | "model_unavailable"
  | "rate_limited"
  | "timeout"
  | "invalid_request"
  | "upstream_error";

const statusFor: Record<ModelErrorCode, number> = {
  model_unavailable: 503,
  rate_limited: 429,
  timeout: 504,
  invalid_request: 400,
  upstream_error: 502,
};

export class ModelError extends Error {
  readonly status: number;
  constructor(
    readonly code: ModelErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModelError";
    this.status = statusFor[code];
  }
}

export type CallOptions = {
  // Defaults to the global fetch. A service binding or a test harness passes
  // its own; the request and every check are the same either way.
  fetcher?: { fetch: typeof fetch };
  timeoutMs?: number;
  signal?: AbortSignal;
};

export const defaultTimeoutMs = 30_000;

export async function callModel<T>(
  endpoint: ModelEndpoint,
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  { fetcher, timeoutMs = defaultTimeoutMs, signal }: CallOptions = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await (fetcher ?? globalThis).fetch(
      new URL(path, endpoint.url),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${endpoint.key}`,
        },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    );
  } catch (error) {
    if (timeout.aborted)
      throw new ModelError(
        "timeout",
        `Model service did not answer within ${timeoutMs} ms`,
      );
    if (signal?.aborted) throw error;
    throw new ModelError(
      "model_unavailable",
      `Model service unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    const detail = `Model service answered ${response.status}: ${text.slice(0, 500)}`;
    if (response.status === 429) throw new ModelError("rate_limited", detail);
    if ([400, 404, 413, 422].includes(response.status))
      throw new ModelError("invalid_request", detail);
    if (response.status === 401 || response.status === 403)
      throw new ModelError("model_unavailable", detail);
    throw new ModelError("upstream_error", detail);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ModelError("upstream_error", "Model service returned non-JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    throw new ModelError(
      "upstream_error",
      `Model service response does not match the contract: ${parsed.error.message}`,
    );
  return parsed.data;
}
