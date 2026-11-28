// Browser calls to the API, which the app serves on its own origin
// (/api/auth/* for Better Auth, /v1/* for the rest).

import { announceDataChanged } from "../../lib/data-changed";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

// An error page that isn't JSON (a 500 from the platform) reads as no detail,
// so the caller shows its generic message rather than a parse error.
function parseBody(text: string, ok: boolean): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (cause) {
    if (ok) throw cause;
    return null;
  }
}

// Better Auth answers { message, code }; /v1 answers { error: { code,
// message } }.
function errorFrom(body: unknown, status: number) {
  const detail = (body ?? {}) as {
    message?: string;
    error?: string | { message?: string; code?: string };
    code?: string;
  };
  const nested = typeof detail.error === "object" ? detail.error : undefined;
  return new ApiError(
    detail.message ??
      nested?.message ??
      (typeof detail.error === "string" ? detail.error : undefined) ??
      "Something went wrong. Try again.",
    status,
    detail.code ?? nested?.code,
  );
}

export async function apiFetch<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const text = await response.text();
  const body = parseBody(text, response.ok);
  if (!response.ok) {
    throw errorFrom(body, response.status);
  }
  if ((init.method ?? "GET").toUpperCase() !== "GET") announceDataChanged();
  return body as T;
}

/** POST to a Better Auth endpoint under /api/auth. */
export const authPost = <T = unknown>(
  path: string,
  body: unknown = {},
  headers?: Record<string, string>,
) =>
  apiFetch<T>(`/api/auth${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });

/** A /v1 route in one organization that answers text, such as NDJSON. */
export async function orgText(organizationId: string, path: string) {
  const response = await fetch(`/v1/orgs/${organizationId}${path}`, {
    credentials: "same-origin",
  });
  const text = await response.text();
  if (!response.ok) throw errorFrom(parseBody(text, false), response.status);
  return text;
}

/** A /v1 route in one organization. */
export const orgApi = <T = unknown>(
  organizationId: string,
  path: string,
  init?: RequestInit,
) => apiFetch<T>(`/v1/orgs/${organizationId}${path}`, init);
