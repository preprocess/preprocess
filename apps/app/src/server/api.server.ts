import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

/** Hands a browser request for /api/auth/* or /v1/* to the API Worker. */
export const forwardToApi = (request: Request) => env.API.fetch(request);

/**
 * Calls the API from a server function as the person making the current
 * request: their cookies, and this app's origin for Better Auth's CSRF check.
 */
export async function apiRequest(path: string, init: RequestInit = {}) {
  const request = getRequest();
  const headers = new Headers(init.headers);
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  headers.set("origin", new URL(request.url).origin);
  if (typeof init.body === "string")
    headers.set("content-type", "application/json");
  return env.API.fetch(
    new Request(new URL(path, request.url), { ...init, headers }),
  );
}

export async function apiJson<T>(path: string, init?: RequestInit) {
  const response = await apiRequest(path, init);
  if (!response.ok)
    throw new Error(`${init?.method ?? "GET"} ${path}: ${response.status}`);
  return (await response.json()) as T;
}

// One session lookup per incoming request, however many /v1 calls a server
// function makes. The API still checks membership on every call.
const organizationIds = new WeakMap<Request, Promise<string>>();

/** The session's active organization. */
export function activeOrganizationId() {
  const request = getRequest();
  let organizationId = organizationIds.get(request);
  if (!organizationId) {
    organizationId = apiJson<{
      session: { activeOrganizationId?: string | null };
    } | null>("/api/auth/get-session").then((session) => {
      const id = session?.session.activeOrganizationId;
      if (!id) throw new Error("No active organization.");
      return id;
    });
    organizationIds.set(request, organizationId);
  }
  return organizationId;
}

/** A /v1 path in the session's active organization. */
export async function activeOrgPath(path: string) {
  return `/v1/orgs/${await activeOrganizationId()}${path}`;
}

/** Calls a /v1 route in the session's active organization. */
export async function activeOrgRequest(path: string, init?: RequestInit) {
  return apiRequest(await activeOrgPath(path), init);
}

/**
 * GET a /v1 route in the session's active organization. `notFound` is what
 * a 404 returns instead of throwing.
 */
export async function activeOrgJson<T>(
  path: string,
  options: { notFound?: T } = {},
) {
  const response = await activeOrgRequest(path);
  if (response.status === 404 && "notFound" in options)
    return options.notFound as T;
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return (await response.json()) as T;
}
