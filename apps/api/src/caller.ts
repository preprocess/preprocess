// Who is calling an organization's routes. PLAT-38's Better Auth middleware
// (step 1) replaces this file with the same exports; until then it accepts
// only organization-owned API keys (Better Auth's api-key plugin rows, keyed
// by the SHA-256 of the key), which is what the CLI and the GitHub Action send.

import { orgId, withoutOrg, type OrgId } from "@preprocess/db/client";
import { apikey } from "@preprocess/db/schema/auth";
import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import type { Env } from "./env.ts";

export type Caller =
  | { type: "person"; userId: string; role: "owner" | "admin" | "member" }
  | { type: "api_key"; keyId: string; role: "admin" };

export type OrgVariables = {
  org: OrgId;
  caller: Caller;
  request: { ip: string | null; requestId: string; actorId: string };
};

const hashKey = async (key: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};

export const orgCaller = createMiddleware<{
  Bindings: Env;
  Variables: OrgVariables;
}>(async (c, next) => {
  const org = c.req.param("org");
  const header = c.req.header("authorization") ?? "";
  const key =
    /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? c.req.header("x-api-key");
  if (!org || !key) throw new HTTPException(401, { message: "unauthorized" });
  const hashed = await hashKey(key);
  const [row] = await withoutOrg(c.env, "authenticate an API key", (tx) =>
    tx
      .select({ id: apikey.id, enabled: apikey.enabled, expiresAt: apikey.expiresAt })
      .from(apikey)
      .where(and(eq(apikey.key, hashed), eq(apikey.referenceId, org))),
  );
  if (!row || row.enabled === false || (row.expiresAt && row.expiresAt < new Date()))
    throw new HTTPException(401, { message: "unauthorized" });
  c.set("org", orgId(org));
  c.set("caller", { type: "api_key", keyId: row.id, role: "admin" });
  c.set("request", {
    ip: c.req.header("cf-connecting-ip") ?? null,
    requestId: c.req.header("cf-ray") ?? crypto.randomUUID(),
    actorId: row.id,
  });
  await next();
});

export const requireAdmin = (caller: Caller) => {
  if (caller.role !== "owner" && caller.role !== "admin")
    throw new HTTPException(403, { message: "needs an Admin or Owner" });
};

export const actor = (caller: Caller) =>
  caller.type === "person"
    ? { actorType: "person" as const, actorId: caller.userId }
    : { actorType: "api_key" as const, actorId: caller.keyId };

export const eventBase = (v: OrgVariables) => ({
  organizationId: v.org,
  ...actor(v.caller),
  ip: v.request.ip,
  requestId: v.request.requestId,
});
