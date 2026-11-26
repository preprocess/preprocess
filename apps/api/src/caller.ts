// Resolves who is calling /v1/orgs/{org}/* and whether they belong to that
// organization (spec 15: the organization comes from the path, checked against
// the caller's membership or key, never from a "current organization").

import { audit } from "@preprocess/db/audit";
import { orgId, withOrg } from "@preprocess/db/client";
import type { OrgId } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { groupMembers, groups } from "@preprocess/db/schema/access";
import { member } from "@preprocess/db/schema/auth";
import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { readSession, requestContext, withAuth } from "./auth.ts";
import type { RequestContext } from "./auth.ts";
import type { Env } from "./env.ts";

export type OrgRole = "owner" | "admin" | "member";

export type Caller =
  | { type: "person"; userId: string; role: OrgRole }
  // Organization API keys are created by Admins and act with Admin rights.
  | { type: "api_key"; keyId: string; role: "admin" };

export type OrgVariables = {
  org: OrgId;
  caller: Caller;
  request: RequestContext;
};

const bearer = (request: Request) => {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return request.headers.get("x-api-key");
};

export const orgCaller = createMiddleware<{
  Bindings: Env;
  Variables: OrgVariables;
}>(async (c, next) => {
  const pathOrg = c.req.param("org");
  if (!pathOrg) throw new HTTPException(404);
  const request = requestContext(c.req.raw);
  const key = bearer(c.req.raw);

  let caller: Caller | null = null;
  if (key) {
    const result = await withAuth(c.env, request, (auth) =>
      auth.api.verifyApiKey({ body: { key } }),
    );
    if (!result.valid || !result.key)
      throw new HTTPException(401, { message: "Invalid API key." });
    if (result.key.referenceId !== pathOrg)
      throw new HTTPException(403, {
        message: "Not a member of this organization.",
      });
    caller = { type: "api_key", keyId: result.key.id, role: "admin" };
  } else {
    const session = await readSession(c.env, c.req.raw);
    if (!session) throw new HTTPException(401, { message: "Sign in first." });
    // Reading the membership through withOrg on the path's organization can
    // only ever see that organization's rows.
    const [membership] = await withOrg(c.env, orgId(pathOrg), (tx) =>
      tx
        .select({ role: member.role })
        .from(member)
        .where(
          and(
            eq(member.organizationId, pathOrg),
            eq(member.userId, session.user.id),
          ),
        ),
    );
    if (!membership)
      throw new HTTPException(403, {
        message: "Not a member of this organization.",
      });
    caller = {
      type: "person",
      userId: session.user.id,
      role: membership.role as OrgRole,
    };
  }

  c.set("org", orgId(pathOrg));
  c.set("caller", caller);
  c.set("request", request);
  await next();
});

export const requireAdmin = (caller: Caller) => {
  if (caller.role !== "owner" && caller.role !== "admin")
    throw new HTTPException(403, {
      message: "Only Owners and Admins can do this.",
    });
};

// Owners, Admins (and API keys, which act as Admin) and the Developers group.
export const requireDeveloper = async (tx: Tx, caller: Caller) => {
  if (caller.role === "owner" || caller.role === "admin") return;
  const [developer] =
    caller.type === "person"
      ? await tx
          .select({ id: groups.id })
          .from(groupMembers)
          .innerJoin(groups, eq(groups.id, groupMembers.groupId))
          .where(
            and(
              eq(groupMembers.userId, caller.userId),
              eq(groups.isDevelopers, true),
            ),
          )
      : [];
  if (!developer)
    throw new HTTPException(403, {
      message: "Only Owners, Admins and the Developers group can do this.",
    });
};

// Deploying and promoting (rollback is promoting an earlier deployment) need
// a Developer (spec 2). A refusal is audited on its own, since the action's
// transaction never commits.
export const requireDeployer = async (
  env: Env,
  vars: OrgVariables,
  operation: "deploy" | "promote",
  agent: string,
) => {
  try {
    await withOrg(env, vars.org, (tx) => requireDeveloper(tx, vars.caller));
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      await withOrg(env, vars.org, (tx) =>
        audit(tx, {
          ...eventBase(vars),
          action: "deployment.denied",
          targetType: "agent",
          data: { agent, operation },
        }),
      );
    throw error;
  }
};

// Who, where and from which request, for an audit event in this organization.
export const eventBase = (vars: OrgVariables) => ({
  organizationId: vars.org,
  ...actor(vars.caller),
  ip: vars.request.ip,
  requestId: vars.request.requestId,
});

export const actor = (caller: Caller) =>
  caller.type === "person"
    ? ({ actorType: "person", actorId: caller.userId } as const)
    : ({ actorType: "api_key", actorId: caller.keyId } as const);
