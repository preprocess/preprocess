// Directory sync settings (spec 13, PRE-138). Owners manage them; Admins read
// them (Design's decision 1). The status of the organization's SCIM
// connection, its one token, its latest sync and its synced groups; issuing
// a token (shown once, kept only as a digest and its last four characters)
// needs scim in the plan, while reading and revoking keep working after the
// plan or license lapses. SCIM itself is served by Better Auth at
// /api/auth/scim/v2 (scim.ts).

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg, withoutOrg } from "@preprocess/db/client";
import type { SystemTx, Tx } from "@preprocess/db/client";
import { groupMembers, groups } from "@preprocess/db/schema/access";
import {
  organization,
  scimManagedConnection,
  scimManagedCredential,
  scimUser,
  user,
} from "@preprocess/db/schema/auth";
import { directorySync } from "@preprocess/db/schema/directory-sync";
import { and, asc, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { createAuth } from "../auth.ts";
import { eventBase } from "../caller.ts";
import type { Caller, OrgVariables } from "../caller.ts";
import { agentsNamingGroup } from "../deploy.ts";
import type { Env } from "../env.ts";
import { removedGroupAudience } from "../notify.ts";
import { getPlan, unavailable } from "../plan.ts";
import { refusal, SCIM_PATH, SCIM_SCOPES, SYNC_GAP_MS } from "../scim.ts";

const OrgParam = z.object({ org: z.string() });
const TokenParam = OrgParam.extend({ prefix: z.string() });

const Token = z
  .object({
    prefix: z.string().openapi({
      description: "The token's public start, which identifies it",
    }),
    status: z.enum(["active", "expired"]),
    last4: z.string().nullable().openapi({
      description: "The token's last four characters",
    }),
    createdAt: z.string(),
    createdBy: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .openapi({ description: "Null once that person is deleted" }),
    lastUsedAt: z.string().nullable().openapi({
      description: "Updated at most every five minutes",
    }),
    expiresAt: z.string(),
  })
  .openapi("ScimToken");

const SyncedGroup = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    memberCount: z.number(),
    removedAt: z.string().nullable().openapi({
      description: "When the directory deleted it; the group stays, empty",
    }),
    removedMembers: z.number().nullable().openapi({
      description: "How many people lost its access when it was removed",
    }),
    agents: z.number().nullable().openapi({
      description:
        "For a removed group, how many agents' live deployments name it",
    }),
  })
  .openapi("ScimSyncedGroup");

const Status = z
  .object({
    allowed: z.boolean().openapi({ description: "Whether the plan has scim" }),
    reason: z
      .enum(["plan", "license_missing", "license_expired"])
      .nullable()
      .openapi({ description: "Why directory sync is off, when it is" }),
    license: z
      .object({
        status: z.enum(["active", "grace", "expired"]),
        expiresAt: z.string(),
        graceEndsAt: z.string().openapi({
          description: "When paid features turn off (spec 16)",
        }),
      })
      .nullable()
      .openapi({ description: "Self-hosted only: the install's license" }),
    canEdit: z.boolean().openapi({
      description: "Owners on a plan with scim; everyone else reads",
    }),
    baseUrl: z.string(),
    connection: z.object({ id: z.string(), createdAt: z.string() }).nullable(),
    token: Token.nullable().openapi({
      description: "The current token; there is one at a time",
    }),
    sync: z.object({
      lastSyncAt: z.string().nullable().openapi({
        description: "The directory's latest change",
      }),
      running: z.boolean().openapi({
        description:
          "Whether the directory sent a change in the last 2 minutes",
      }),
      received: z.number().nullable().openapi({
        description: "Changes received in the running sync",
      }),
      people: z.object({ synced: z.number(), deactivated: z.number() }),
    }),
    groups: z.array(SyncedGroup).openapi({
      description: "Removed groups first, then by name",
    }),
  })
  .openapi("ScimStatus");

const RemovedGroups = z
  .object({
    groups: z.array(
      z.object({
        id: z.string(),
        slug: z.string(),
        name: z.string(),
        removedAt: z.string(),
        agents: z.number(),
      }),
    ),
  })
  .openapi("ScimRemovedGroups");

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

// The organization's tokens that also match `where`.
const credentials = (tx: Tx, org: string, where: SQL | undefined) =>
  tx
    .select({
      prefix: scimManagedCredential.credentialId,
      status: scimManagedCredential.status,
      createdAt: scimManagedCredential.createdAt,
      createdById: scimManagedCredential.createdBy,
      createdByName: user.name,
      lastUsedAt: scimManagedCredential.lastUsedAt,
      expiresAt: scimManagedCredential.expiresAt,
      connectionId: scimManagedConnection.connectionId,
      last4: directorySync.tokenLast4,
      last4Of: directorySync.tokenCredentialId,
    })
    .from(scimManagedCredential)
    .innerJoin(
      scimManagedConnection,
      eq(scimManagedConnection.id, scimManagedCredential.connectionRecordId),
    )
    .leftJoin(user, eq(user.id, scimManagedCredential.createdBy))
    .leftJoin(
      directorySync,
      eq(
        directorySync.organizationId,
        scimManagedConnection.provisioningDomainId,
      ),
    )
    .where(and(eq(scimManagedConnection.provisioningDomainId, org), where));

type Credential = Awaited<ReturnType<typeof credentials>>[number];

const toToken = (c: Credential, now = Date.now()) => ({
  prefix: c.prefix,
  status:
    c.status === "active" && c.expiresAt.getTime() > now
      ? ("active" as const)
      : ("expired" as const),
  last4: c.last4Of === c.prefix ? c.last4 : null,
  createdAt: c.createdAt.toISOString(),
  createdBy:
    c.createdByName === null
      ? null
      : { id: c.createdById, name: c.createdByName },
  lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
  expiresAt: c.expiresAt.toISOString(),
});

// Issuing needs scim in the plan; the refusal says why it is off.
const requirePlan = async (env: Env, org: OrgVariables["org"]) => {
  const reason = unavailable(await getPlan(env, org), "scim");
  if (reason) throw new HTTPException(403, { message: refusal(reason) });
};

const TokenBody = {
  content: {
    "application/json": {
      schema: z.object({
        expiresInDays: z.number().int().min(1).max(730).default(365),
      }),
    },
  },
};

const Issued = Token.extend({
  token: z.string().openapi({ description: "Shown only once" }),
});

type Context = { env: Env; var: OrgVariables };

const revoke = async (
  c: Context,
  tx: SystemTx,
  userId: string,
  connectionId: string,
  revoked: Credential[],
  regenerated = false,
) => {
  const auth = createAuth(c.env, tx, c.var.request);
  for (const credential of revoked) {
    await auth.api.revokeSCIMManagedCredential({
      body: {
        connectionId,
        provisioningDomainId: c.var.org,
        credentialId: credential.prefix,
        actorId: userId,
      },
    });
    await audit(tx, {
      ...eventBase(c.var),
      action: "scim.token.revoked",
      targetType: "scim_token",
      targetId: credential.prefix,
      ...(regenerated ? { data: { regenerated } } : {}),
    });
  }
};

// Issues the organization's token, creating its connection on first use;
// replacing revokes every active token first. One transaction, with the
// organization's row locked so two Owners can't race.
const issue = (
  c: Context,
  userId: string,
  expiresInDays: number,
  replace: boolean,
) =>
  withoutOrg(c.env, "scim: issue token", async (tx) => {
    const org = c.var.org;
    await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, org))
      .for("update");
    const connection = await activeConnection(tx, org);
    const active = connection
      ? await credentials(
          tx,
          org,
          and(
            eq(scimManagedCredential.connectionRecordId, connection.id),
            eq(scimManagedCredential.status, "active"),
          ),
        )
      : [];
    const now = Date.now();
    const current = active.filter((t) => t.expiresAt.getTime() > now);
    if (!replace && current.length)
      throw new HTTPException(409, {
        message:
          "This organization already has a directory sync token. Regenerate it to replace it.",
      });
    if (replace && !current.length)
      throw new HTTPException(404, {
        message: "There's no directory sync token to regenerate.",
      });
    if (connection)
      await revoke(c, tx, userId, connection.connectionId, active, replace);
    const body = {
      provisioningDomainId: org,
      scopes: [...SCIM_SCOPES],
      expiresAt: new Date(now + expiresInDays * day),
      actorId: userId,
    };
    const auth = createAuth(c.env, tx, c.var.request);
    const created = connection
      ? await auth.api.rotateSCIMManagedCredential({
          body: { ...body, connectionId: connection.connectionId },
        })
      : await auth.api.createSCIMManagedConnection({
          body: { ...body, creationRequestId: crypto.randomUUID() },
        });
    const prefix = created.credential.credentialId;
    const hint = {
      tokenCredentialId: prefix,
      tokenLast4: created.token.slice(-4),
    };
    await tx
      .insert(directorySync)
      .values({ organizationId: org, ...hint })
      .onConflictDoUpdate({ target: directorySync.organizationId, set: hint });
    const [credential] = await credentials(
      tx,
      org,
      eq(scimManagedCredential.credentialId, prefix),
    );
    await audit(tx, {
      ...eventBase(c.var),
      action: "scim.token.created",
      targetType: "scim_token",
      targetId: prefix,
      data: {
        expiresAt: body.expiresAt.toISOString(),
        ...(replace ? { regenerated: true } : {}),
      },
    });
    return { ...toToken(credential!), token: created.token };
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
      summary: "Directory sync status (Owner, Admin)",
      request: { params: OrgParam },
      responses: {
        200: json(Status, "The directory sync connection"),
        403: { description: "Members don't see directory sync" },
      },
    }),
    async (c) => {
      const caller = c.var.caller;
      if (caller.role === "member")
        throw new HTTPException(403, {
          message: "Only Owners and Admins can see directory sync.",
        });
      const org = c.var.org;
      const plan = await getPlan(c.env, org);
      const reason = unavailable(plan, "scim");
      const state = plan.license;
      const license =
        state && "license" in state
          ? {
              status: state.status,
              expiresAt: state.license.expiresAt.toISOString(),
              graceEndsAt: state.license.graceEndsAt.toISOString(),
            }
          : null;
      const status = await withoutOrg(c.env, "scim: status", async (tx) => {
        const connection = await activeConnection(tx, org);
        const [token] = await credentials(
          tx,
          org,
          inArray(scimManagedCredential.status, ["active", "expired"]),
        )
          .orderBy(desc(scimManagedCredential.createdAt))
          .limit(1);
        const [sync] = await tx
          .select()
          .from(directorySync)
          .where(eq(directorySync.organizationId, org));
        const people = await tx
          .select({ active: scimUser.active, n: count() })
          .from(scimUser)
          .where(eq(scimUser.provisioningDomainId, org))
          .groupBy(scimUser.active);
        const synced = await tx
          .select({
            id: groups.id,
            slug: groups.slug,
            name: groups.name,
            removedAt: groups.syncedRemovedAt,
            removedMembers: groups.syncedRemovedMembers,
            memberCount: count(groupMembers.userId),
          })
          .from(groups)
          .leftJoin(groupMembers, eq(groupMembers.groupId, groups.id))
          .where(
            and(eq(groups.organizationId, org), isNotNull(groups.scimGroupId)),
          )
          .groupBy(groups.id)
          .orderBy(desc(isNotNull(groups.syncedRemovedAt)), asc(groups.name));
        const listed = [];
        for (const g of synced)
          listed.push({
            ...g,
            removedAt: g.removedAt?.toISOString() ?? null,
            removedMembers: g.removedAt ? (g.removedMembers ?? 0) : null,
            agents: g.removedAt
              ? (await agentsNamingGroup(tx, g.id)).length
              : null,
          });
        const lastSyncAt = sync?.lastSyncAt ?? null;
        const running =
          lastSyncAt !== null &&
          Date.now() - lastSyncAt.getTime() < SYNC_GAP_MS;
        return {
          connection: connection
            ? {
                id: connection.connectionId,
                createdAt: connection.createdAt.toISOString(),
              }
            : null,
          token: token ? toToken(token) : null,
          sync: {
            lastSyncAt: lastSyncAt?.toISOString() ?? null,
            running,
            received: running ? (sync?.syncReceived ?? 0) : null,
            people: {
              synced: people.find((p) => p.active)?.n ?? 0,
              deactivated: people.find((p) => !p.active)?.n ?? 0,
            },
          },
          groups: listed,
        };
      });
      return c.json(
        {
          allowed: reason === null,
          reason,
          license,
          canEdit:
            reason === null &&
            caller.type === "person" &&
            caller.role === "owner",
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
      summary: "Generate the directory sync token (Owner)",
      request: { params: OrgParam, body: TokenBody },
      responses: {
        201: json(Issued, "The new token"),
        409: { description: "The organization already has a token" },
      },
    }),
    async (c) => {
      const userId = requireOwner(c.var.caller);
      await requirePlan(c.env, c.var.org);
      const { expiresInDays } = c.req.valid("json");
      return c.json(await issue(c, userId, expiresInDays, false), 201);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/scim/tokens/regenerate",
      tags: ["Directory sync"],
      summary: "Replace the directory sync token (Owner)",
      description:
        "Revokes the current token at once and issues a new one, in one transaction.",
      request: { params: OrgParam, body: TokenBody },
      responses: {
        201: json(Issued, "The new token"),
        404: { description: "There is no token to regenerate" },
      },
    }),
    async (c) => {
      const userId = requireOwner(c.var.caller);
      await requirePlan(c.env, c.var.org);
      const { expiresInDays } = c.req.valid("json");
      return c.json(await issue(c, userId, expiresInDays, true), 201);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/scim/tokens/{prefix}",
      tags: ["Directory sync"],
      summary: "Revoke the directory sync token (Owner)",
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
        const [found] = await credentials(
          tx,
          org,
          eq(scimManagedCredential.credentialId, prefix),
        );
        if (!found) throw new HTTPException(404, { message: "No such token." });
        if (found.status !== "active") return;
        await revoke(c, tx, userId, found.connectionId, [found]);
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/scim/removed-groups",
      tags: ["Directory sync"],
      summary: "Synced groups the identity provider removed",
      description:
        "For the sidebar notice. Owners, Admins and the Developers group see each removed group until it is deleted or the directory sends it again; anyone else gets an empty list.",
      request: { params: OrgParam },
      responses: { 200: json(RemovedGroups, "The removed groups") },
    }),
    async (c) => {
      const caller = c.var.caller;
      const removed = await withOrg(c.env, c.var.org, async (tx) => {
        if (
          caller.type === "person" &&
          !(await removedGroupAudience(tx, c.var.org)).includes(caller.userId)
        )
          return [];
        const rows = await tx
          .select({
            id: groups.id,
            slug: groups.slug,
            name: groups.name,
            removedAt: groups.syncedRemovedAt,
          })
          .from(groups)
          .where(
            and(
              eq(groups.organizationId, c.var.org),
              isNotNull(groups.scimGroupId),
              isNotNull(groups.syncedRemovedAt),
            ),
          )
          .orderBy(desc(groups.syncedRemovedAt));
        const listed = [];
        for (const g of rows)
          listed.push({
            id: g.id,
            slug: g.slug,
            name: g.name,
            removedAt: g.removedAt!.toISOString(),
            agents: (await agentsNamingGroup(tx, g.id)).length,
          });
        return listed;
      });
      return c.json({ groups: removed }, 200);
    },
  );
