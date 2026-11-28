// Directory sync settings (spec 13, PRE-138): Owners only. The status of the
// organization's SCIM connection, its tokens and its synced groups; issuing a
// token (shown once, kept only as a digest) needs a plan with scim, while
// reading and revoking keep working after the plan lapses. SCIM itself is
// served by Better Auth at /api/auth/scim/v2 (scim.ts).

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withoutOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { groupMembers, groups } from "@preprocess/db/schema/access";
import {
  organization,
  scimGroup,
  scimManagedConnection,
  scimManagedCredential,
  scimUser,
} from "@preprocess/db/schema/auth";
import { and, asc, count, desc, eq, gt, isNotNull, max } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { createAuth } from "../auth.ts";
import { eventBase } from "../caller.ts";
import type { Caller, OrgVariables } from "../caller.ts";
import type { Env } from "../env.ts";
import { getPlan } from "../plan.ts";
import { MAX_SCIM_TOKENS, SCIM_PATH, SCIM_SCOPES } from "../scim.ts";

const OrgParam = z.object({ org: z.string() });
const TokenParam = OrgParam.extend({ prefix: z.string() });

const Token = z
  .object({
    prefix: z.string().openapi({
      description: "The token's public start, which identifies it",
    }),
    status: z.enum(["active", "expired", "revoked"]),
    createdAt: z.string(),
    createdBy: z.string(),
    lastUsedAt: z.string().nullable().openapi({
      description: "Updated at most every five minutes",
    }),
    expiresAt: z.string(),
    revokedAt: z.string().nullable(),
  })
  .openapi("ScimToken");

const SyncedGroup = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    memberCount: z.number(),
    removedAt: z.string().nullable().openapi({
      description: "When the directory deleted it; the group stays",
    }),
  })
  .openapi("ScimSyncedGroup");

const Status = z
  .object({
    allowed: z.boolean().openapi({ description: "Whether the plan has scim" }),
    baseUrl: z.string(),
    connection: z.object({ id: z.string(), createdAt: z.string() }).nullable(),
    lastSyncAt: z.string().nullable().openapi({
      description: "The directory's latest change to a user or group",
    }),
    tokens: z.array(Token),
    groups: z.array(SyncedGroup),
  })
  .openapi("ScimStatus");

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const day = 86_400_000;

const requireOwner = (caller: Caller) => {
  if (caller.type !== "person" || caller.role !== "owner")
    throw new HTTPException(403, {
      message: "Only Owners can manage directory sync.",
    });
  return caller.userId;
};

const activeConnection = async (tx: Tx, org: string) => {
  const [found] = await tx
    .select()
    .from(scimManagedConnection)
    .where(
      and(
        eq(scimManagedConnection.provisioningDomainId, org),
        eq(scimManagedConnection.status, "active"),
      ),
    )
    .orderBy(asc(scimManagedConnection.createdAt))
    .limit(1);
  return found;
};

const credentials = (tx: Tx, org: string) =>
  tx
    .select({
      prefix: scimManagedCredential.credentialId,
      status: scimManagedCredential.status,
      createdAt: scimManagedCredential.createdAt,
      createdBy: scimManagedCredential.createdBy,
      lastUsedAt: scimManagedCredential.lastUsedAt,
      expiresAt: scimManagedCredential.expiresAt,
      revokedAt: scimManagedCredential.revokedAt,
      connectionId: scimManagedConnection.connectionId,
    })
    .from(scimManagedCredential)
    .innerJoin(
      scimManagedConnection,
      eq(scimManagedConnection.id, scimManagedCredential.connectionRecordId),
    )
    .where(eq(scimManagedConnection.provisioningDomainId, org))
    .$dynamic();

type Credential = Awaited<ReturnType<typeof credentials>>[number];

const toToken = (c: Credential, now = Date.now()) => ({
  prefix: c.prefix,
  status:
    c.status === "active"
      ? c.expiresAt.getTime() > now
        ? ("active" as const)
        : ("expired" as const)
      : c.status === "expired"
        ? ("expired" as const)
        : ("revoked" as const),
  createdAt: c.createdAt.toISOString(),
  createdBy: c.createdBy,
  lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
  expiresAt: c.expiresAt.toISOString(),
  revokedAt: c.revokedAt?.toISOString() ?? null,
});

export const scimRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/scim",
      tags: ["Directory sync"],
      request: { params: OrgParam },
      responses: { 200: json(Status, "The directory sync connection") },
    }),
    async (c) => {
      requireOwner(c.var.caller);
      const org = c.var.org;
      const allowed = (await getPlan(c.env, org)).has("scim");
      const status = await withoutOrg(c.env, "scim: status", async (tx) => {
        const connection = await activeConnection(tx, org);
        const tokens = await credentials(tx, org).orderBy(
          desc(scimManagedCredential.createdAt),
        );
        const [users] = await tx
          .select({ at: max(scimUser.updatedAt) })
          .from(scimUser)
          .where(eq(scimUser.provisioningDomainId, org));
        const [synced] = await tx
          .select({ at: max(scimGroup.updatedAt) })
          .from(scimGroup)
          .where(eq(scimGroup.provisioningDomainId, org));
        const syncedGroups = await tx
          .select({
            id: groups.id,
            slug: groups.slug,
            name: groups.name,
            removedAt: groups.syncedRemovedAt,
            memberCount: count(groupMembers.userId),
          })
          .from(groups)
          .leftJoin(groupMembers, eq(groupMembers.groupId, groups.id))
          .where(
            and(eq(groups.organizationId, org), isNotNull(groups.scimGroupId)),
          )
          .groupBy(groups.id)
          .orderBy(asc(groups.name));
        const times = [users?.at, synced?.at].filter((t): t is Date => !!t);
        return {
          connection: connection
            ? {
                id: connection.connectionId,
                createdAt: connection.createdAt.toISOString(),
              }
            : null,
          lastSyncAt: times.length
            ? new Date(Math.max(...times.map((t) => t.getTime()))).toISOString()
            : null,
          tokens: tokens.map((t) => toToken(t)),
          groups: syncedGroups.map((g) => ({
            ...g,
            removedAt: g.removedAt?.toISOString() ?? null,
          })),
        };
      });
      return c.json(
        {
          allowed,
          baseUrl: new URL(SCIM_PATH, c.env.APP_URL).toString(),
          ...status,
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/scim/tokens",
      tags: ["Directory sync"],
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                expiresInDays: z.number().int().min(1).max(730).default(365),
              }),
            },
          },
        },
      },
      responses: {
        201: json(
          Token.extend({
            token: z.string().openapi({ description: "Shown only once" }),
          }),
          "The new token",
        ),
        409: { description: "The organization has the most tokens it may" },
      },
    }),
    async (c) => {
      const userId = requireOwner(c.var.caller);
      const org = c.var.org;
      if (!(await getPlan(c.env, org)).has("scim"))
        throw new HTTPException(403, {
          message: "Directory sync isn't included in this organization's plan.",
        });
      const { expiresInDays } = c.req.valid("json");
      const issued = await withoutOrg(
        c.env,
        "scim: issue token",
        async (tx) => {
          // One connection per organization, even when two Owners ask at once.
          await tx
            .select({ id: organization.id })
            .from(organization)
            .where(eq(organization.id, org))
            .for("update");
          const auth = createAuth(c.env, tx, c.var.request);
          const connection = await activeConnection(tx, org);
          const body = {
            provisioningDomainId: org,
            scopes: [...SCIM_SCOPES],
            expiresAt: new Date(Date.now() + expiresInDays * day),
            actorId: userId,
          };
          let created;
          if (connection) {
            const [{ active = 0 } = {}] = await tx
              .select({ active: count() })
              .from(scimManagedCredential)
              .where(
                and(
                  eq(scimManagedCredential.connectionRecordId, connection.id),
                  eq(scimManagedCredential.status, "active"),
                  gt(scimManagedCredential.expiresAt, new Date()),
                ),
              );
            if (active >= MAX_SCIM_TOKENS)
              throw new HTTPException(409, {
                message: `An organization can have ${MAX_SCIM_TOKENS} directory sync tokens at a time. Revoke one first.`,
              });
            created = await auth.api.rotateSCIMManagedCredential({
              body: { ...body, connectionId: connection.connectionId },
            });
          } else {
            created = await auth.api.createSCIMManagedConnection({
              body: { ...body, creationRequestId: crypto.randomUUID() },
            });
          }
          const [credential] = await credentials(tx, org).where(
            eq(
              scimManagedCredential.credentialId,
              created.credential.credentialId,
            ),
          );
          await audit(tx, {
            ...eventBase(c.var),
            action: "scim.token.created",
            targetType: "scim_token",
            targetId: created.credential.credentialId,
            data: { expiresAt: body.expiresAt.toISOString() },
          });
          return { token: created.token, credential: credential! };
        },
      );
      return c.json(
        { ...toToken(issued.credential), token: issued.token },
        201,
      );
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/scim/tokens/{prefix}",
      tags: ["Directory sync"],
      request: { params: TokenParam },
      responses: {
        204: { description: "Revoked" },
        404: { description: "No such token" },
      },
    }),
    async (c) => {
      const userId = requireOwner(c.var.caller);
      const org = c.var.org;
      const { prefix } = c.req.valid("param");
      await withoutOrg(c.env, "scim: revoke token", async (tx) => {
        const [found] = await credentials(tx, org).where(
          eq(scimManagedCredential.credentialId, prefix),
        );
        if (!found) throw new HTTPException(404, { message: "No such token." });
        if (found.status !== "active") return;
        await createAuth(
          c.env,
          tx,
          c.var.request,
        ).api.revokeSCIMManagedCredential({
          body: {
            connectionId: found.connectionId,
            provisioningDomainId: org,
            credentialId: prefix,
            actorId: userId,
          },
        });
        await audit(tx, {
          ...eventBase(c.var),
          action: "scim.token.revoked",
          targetType: "scim_token",
          targetId: prefix,
        });
      });
      return c.body(null, 204);
    },
  );
