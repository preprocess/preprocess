// Browser calls to the API, which the app serves on its own origin
// (/api/auth/* for Better Auth, /v1/* for the rest).

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
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
  const body = text ? (JSON.parse(text) as unknown) : null;
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
