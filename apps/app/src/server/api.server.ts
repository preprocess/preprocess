import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

/** Hands a browser request for /api/auth/* or /v1/* to the API Worker. */
export const forwardToApi = (request: Request) => env.API.fetch(request);

type Read = { status: number; body: unknown };

// GETs made while serving one incoming request, by path. A page's loader runs
// as one server function, so the session and the organization's agents,
// groups and members are read once per navigation however many parts of the
// page need them. Nothing outlives the request, and the API still checks the
// session and membership on every call.
const reads = new WeakMap<Request, Map<string, Promise<Read>>>();

/**
 * Calls the API from a server function as the person making the current
 * request: their cookies, and this app's origin for Better Auth's CSRF check.
 */
export async function apiRequest(path: string, init: RequestInit = {}) {
  const request = getRequest();
  // A write makes this request's earlier reads stale.
  if ((init.method ?? "GET").toUpperCase() !== "GET") reads.delete(request);
  const headers = new Headers(init.headers);
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const userAgent = request.headers.get("user-agent");
  if (userAgent) headers.set("user-agent", userAgent);
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

/** GETs a path once per incoming request, whoever asks for it. */
function readOnce(path: string): Promise<Read> {
  const request = getRequest();
  let memo = reads.get(request);
  if (!memo) {
    memo = new Map();
    reads.set(request, memo);
  }
  let read = memo.get(path);
  if (!read) {
    read = apiRequest(path).then(async (response) => {
      if (response.ok)
        return { status: response.status, body: await response.json() };
      await response.body?.cancel();
      return { status: response.status, body: null };
    });
    memo.set(path, read);
  }
  return read;
}

type AuthSession = {
  session: { id: string; activeOrganizationId?: string | null };
  user: { id: string };
} | null;

/** Better Auth's session for the current request, or null when signed out. */
export async function authSession<T extends AuthSession = AuthSession>() {
  const { status, body } = await readOnce("/api/auth/get-session");
  if (status !== 200) throw new Error(`GET /api/auth/get-session: ${status}`);
  return body as T;
}

/** The session's active organization. */
export async function activeOrganizationId() {
  const id = (await authSession())?.session.activeOrganizationId;
  if (!id) throw new Error("No active organization.");
  return id;
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
 * GET a /v1 route in the session's active organization, once per incoming
 * request. `notFound` is what a 404 returns instead of throwing.
 */
export async function activeOrgJson<T>(
  path: string,
  options: { notFound?: T } = {},
) {
  const { status, body } = await readOnce(await activeOrgPath(path));
  if (status === 404 && "notFound" in options) return options.notFound as T;
  if (status < 200 || status >= 300) throw new Error(`GET ${path}: ${status}`);
  return body as T;
}
