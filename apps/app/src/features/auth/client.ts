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
    const detail = (body ?? {}) as {
      message?: string;
      error?: string;
      code?: string;
    };
    throw new ApiError(
      detail.message ?? detail.error ?? "Something went wrong. Try again.",
      response.status,
      detail.code,
    );
  }
  if ((init.method ?? "GET").toUpperCase() !== "GET") announceDataChanged();
  return body as T;
}

/** POST to a Better Auth endpoint under /api/auth. */
export const authPost = <T = unknown>(path: string, body: unknown = {}) =>
  apiFetch<T>(`/api/auth${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

/** A /v1 route in one organization. */
export const orgApi = <T = unknown>(
  organizationId: string,
  path: string,
  init?: RequestInit,
) => apiFetch<T>(`/v1/orgs/${organizationId}${path}`, init);
