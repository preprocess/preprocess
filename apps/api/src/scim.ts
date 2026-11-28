// Directory sync (spec 13, PRE-138): SCIM 2.0 through Better Auth's own
// plugin, served at /api/auth/scim/v2. Each organization has at most one
// managed connection whose provisioning domain is the organization's id, and
// up to five bearer tokens, stored only as HMAC digests. The plugin owns the
// SCIM resources (scim_* tables); this file projects them onto our model:
//
// - an active SCIM User is a member of the organization (role member), and
//   an inactive or deleted one is not (Owners keep their membership; an Owner
//   removes an Owner in the app);
// - a person with no active SCIM source and no other organization is
//   deactivated (user.deactivated_at, which refuses sign-in), and the plugin
//   deletes their sessions, device-flow bearer sessions included;
// - each SCIM Group is a group with scim_group_id set, its members those of
//   the SCIM Group. A deleted SCIM Group keeps its group and grants, marked
//   synced_removed_at, for an Owner or Admin to resolve, and Developers,
//   Owners and Admins are emailed (notify.ts). A SCIM Group with the same
//   externalId re-links it;
// - every write counts toward the organization's latest sync
//   (directory_sync), the writes less than SYNC_GAP apart.
//
// Everything runs in the auth request's one transaction (withAuth): the
// plugin's own transaction is a savepoint in it, and every SCIM write and the
// membership changes it causes are audited there, by `scim:<credential>`.

import { scim } from "@better-auth/scim";
import type { AuditInput } from "@preprocess/db/audit";
import { orgId, withoutOrgRead } from "@preprocess/db/client";
import type { SystemTx, Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { groupMembers, groups } from "@preprocess/db/schema/access";
import { directorySync } from "@preprocess/db/schema/directory-sync";
import {
  member,
  scimGroup,
  scimManagedConnection,
  scimManagedCredential,
  scimUser,
  user,
} from "@preprocess/db/schema/auth";
import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import type { Env } from "./env.ts";
import { writeOutbox } from "./outbox.ts";
import { getPlan, unavailable } from "./plan.ts";
import type { Unavailable } from "./plan.ts";

export const SCIM_PATH = "/api/auth/scim/v2";
export const SCIM_SCOPES = [
  "scim.users.read",
  "scim.users.write",
  "scim.groups.read",
  "scim.groups.write",
] as const;
// The plugin's default; it refuses a sixth active token.
export const MAX_SCIM_TOKENS = 5;
// A sync is SCIM writes less than this apart; it is running until this long
// after the latest one.
export const SYNC_GAP_MS = 2 * 60_000;

const CREDENTIAL = /^(ba_scim_credential_[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/;

// The plugin's digests use a key of their own, derived from the auth secret
// so that self-hosted installs need no extra secret. Rotating
// BETTER_AUTH_SECRET invalidates every SCIM token.
const credentialHashSecret = (env: Env) =>
  `${env.BETTER_AUTH_SECRET}:scim-credential-digest`;

export const scimError = (status: number, detail: string) =>
  new Response(
    JSON.stringify({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: String(status),
      detail,
    }),
    { status, headers: { "content-type": "application/scim+json" } },
  );

type Caller = {
  organizationId: string;
  connectionId: string;
  credentialId: string;
};

// The organization and connection a SCIM bearer token names, read from its
// public part. The plugin verifies the secret part.
const scimCaller = async (
  tx: Tx,
  authorization: string | null | undefined,
): Promise<Caller | null> => {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
  const credentialId = token ? CREDENTIAL.exec(token)?.[1] : undefined;
  if (!credentialId) return null;
  const [found] = await tx
    .select({
      organizationId: scimManagedConnection.provisioningDomainId,
      connectionId: scimManagedConnection.connectionId,
    })
    .from(scimManagedCredential)
    .innerJoin(
      scimManagedConnection,
      eq(scimManagedConnection.id, scimManagedCredential.connectionRecordId),
    )
    .where(eq(scimManagedCredential.credentialId, credentialId));
  return found ? { ...found, credentialId } : null;
};

export const refusal = (reason: Unavailable) =>
  reason === "license_expired"
    ? "This install's license has expired, so directory sync has stopped until it's renewed."
    : "Directory sync isn't included in this organization's plan.";

// Spec 16: directory sync stops when the plan or license lapses. The data
// stays, and the IdP gets a SCIM error until the plan is back.
export const refuseWithoutPlan = async (env: Env, request: Request) => {
  const caller = await withoutOrgRead(env, "scim: plan check", (tx) =>
    scimCaller(tx, request.headers.get("authorization")),
  );
  if (!caller) return null;
  const reason = unavailable(
    await getPlan(env, orgId(caller.organizationId)),
    "scim",
  );
  return reason ? scimError(403, refusal(reason)) : null;
};

// One more write in the organization's latest sync, or the first of a new one.
const recordSync = (tx: Tx, organizationId: string) => {
  const recent = sql`${directorySync.lastSyncAt} > now() - make_interval(secs => ${SYNC_GAP_MS / 1000})`;
  return tx
    .insert(directorySync)
    .values({
      organizationId,
      lastSyncAt: sql`now()`,
      syncStartedAt: sql`now()`,
      syncReceived: 1,
    })
    .onConflictDoUpdate({
      target: directorySync.organizationId,
      set: {
        syncStartedAt: sql`case when ${recent} then ${directorySync.syncStartedAt} else now() end`,
        syncReceived: sql`case when ${recent} then ${directorySync.syncReceived} + 1 else 1 end`,
        lastSyncAt: sql`now()`,
      },
    });
};

export const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

// The group for a SCIM Group, created on first sight and renamed with it.
// Its slug is fixed at creation, since agents' code names groups by slug. A
// removed group whose SCIM Group had the same externalId is re-linked
// instead, its members to come from the directory again.
const syncedGroup = async (
  tx: Tx,
  organizationId: string,
  scimGroupId: string,
  name: string,
) => {
  const [found] = await tx
    .select({ id: groups.id, slug: groups.slug, name: groups.name })
    .from(groups)
    .where(
      and(
        eq(groups.organizationId, organizationId),
        eq(groups.scimGroupId, scimGroupId),
      ),
    );
  if (found) {
    if (found.name !== name)
      await tx.update(groups).set({ name }).where(eq(groups.id, found.id));
    return { ...found, name };
  }
  const [source] = await tx
    .select({ externalId: scimGroup.externalId })
    .from(scimGroup)
    .where(eq(scimGroup.id, scimGroupId));
  const externalId = source?.externalId ?? null;
  const [removed] = externalId
    ? await tx
        .select({ id: groups.id, slug: groups.slug })
        .from(groups)
        .where(
          and(
            eq(groups.organizationId, organizationId),
            eq(groups.scimExternalId, externalId),
            isNotNull(groups.syncedRemovedAt),
          ),
        )
        .orderBy(desc(groups.syncedRemovedAt))
        .limit(1)
    : [];
  if (removed) {
    await tx
      .update(groups)
      .set({
        scimGroupId,
        name,
        syncedRemovedAt: null,
        syncedRemovedMembers: null,
      })
      .where(eq(groups.id, removed.id));
    return { ...removed, name };
  }
  const base = slugify(name) || "group";
  const taken = new Set(
    (
      await tx
        .select({ slug: groups.slug })
        .from(groups)
        .where(
          and(
            eq(groups.organizationId, organizationId),
            sql`${groups.slug} like ${`${base}%`}`,
          ),
        )
    ).map((g) => g.slug),
  );
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, 44)}-${n}`;
  const id = newId("group");
  await tx.insert(groups).values({
    id,
    organizationId,
    slug,
    name,
    scimGroupId,
    scimExternalId: externalId,
  });
  return { id, slug, name };
};

type Record = (event: Omit<AuditInput, "ip" | "requestId">) => Promise<unknown>;

// The parts of a Better Auth hook context the SCIM hooks read.
type HookContext = {
  path?: string | undefined;
  params?: unknown;
  headers?: Headers | undefined;
  request?: Request | undefined;
  context: { returned?: unknown };
};

const param = (ctx: HookContext, name: string) => {
  const value = (ctx.params as { [key: string]: unknown } | undefined)?.[name];
  return typeof value === "string" ? value : undefined;
};

// The SCIM plugin and the hooks that audit each SCIM write, for one auth
// request on `tx`.
export const scimDirectory = (env: Env, tx: SystemTx, record: Record) => {
  let caller: Caller | null = null;
  let userBefore: { id: string; userId: string; active: boolean } | undefined;
  let groupBefore: { externalId: string | null; members: number } | undefined;
  const actor = () =>
    ({
      actorType: "platform",
      actorId: caller ? `scim:${caller.credentialId}` : "scim",
    }) as const;

  const plugin = scim({
    connections: [],
    managedConnections: { credentialHashSecret: credentialHashSecret(env) },
    compatibility: { microsoftEntra: { acceptLegacyGroupSchema: true } },
    identity: {
      // A directory may take over a person already in the organization with
      // a verified address; their profile stays theirs. Anyone else is a new
      // user, and an address someone else holds is refused.
      async resolveUser({ provisioningDomainId, resource }) {
        const [existing] = await tx
          .select({ id: user.id })
          .from(user)
          .innerJoin(
            member,
            and(
              eq(member.userId, user.id),
              eq(member.organizationId, provisioningDomainId),
            ),
          )
          .where(
            and(
              sql`lower(${user.email}) = lower(${resource.primaryEmail})`,
              eq(user.emailVerified, true),
            ),
          )
          .limit(1);
        return existing
          ? { action: "link", userId: existing.id, profile: "preserve" }
          : { action: "create" };
      },
      // Runs after the projection below has settled the organization's
      // membership.
      async reconcileUser(state) {
        if (state.active) {
          await tx
            .update(user)
            .set({ deactivatedAt: null })
            .where(
              and(eq(user.id, state.userId), isNotNull(user.deactivatedAt)),
            );
          return;
        }
        const [elsewhere] = await tx
          .select({ id: member.id })
          .from(member)
          .where(eq(member.userId, state.userId))
          .limit(1);
        if (elsewhere) return;
        await tx
          .update(user)
          .set({ deactivatedAt: new Date() })
          .where(and(eq(user.id, state.userId), isNull(user.deactivatedAt)));
      },
    },
    projection: {
      // Every SCIM Group membership is one grant; the group is in the grant's
      // source.
      roles: { map: () => ["member"], exists: () => true },
      async reconcileUser(state) {
        const organizationId = state.provisioningDomainId;
        const event = { organizationId, ...actor(), targetType: "user" };
        const [current] = await tx
          .select({ id: member.id, role: member.role })
          .from(member)
          .where(
            and(
              eq(member.organizationId, organizationId),
              eq(member.userId, state.userId),
            ),
          );
        if (state.active && !current) {
          await tx.insert(member).values({
            id: newId("member"),
            organizationId,
            userId: state.userId,
            role: "member",
            createdAt: new Date(),
          });
          await record({
            ...event,
            action: "member.added",
            targetId: state.userId,
            data: { role: "member" },
          });
        }
        if (!state.active && current && current.role !== "owner") {
          await tx.delete(member).where(eq(member.id, current.id));
          await record({
            ...event,
            action: "member.removed",
            targetId: state.userId,
          });
        }

        const wanted = new Map<string, { id: string; slug: string }>();
        if (state.active)
          for (const { source } of state.grants)
            wanted.set(
              source.id,
              await syncedGroup(
                tx,
                organizationId,
                source.id,
                source.displayName,
              ),
            );
        const held = await tx
          .select({
            id: groups.id,
            slug: groups.slug,
            scimGroupId: groups.scimGroupId,
          })
          .from(groupMembers)
          .innerJoin(groups, eq(groups.id, groupMembers.groupId))
          .where(
            and(
              eq(groupMembers.organizationId, organizationId),
              eq(groupMembers.userId, state.userId),
              isNotNull(groups.scimGroupId),
              isNull(groups.syncedRemovedAt),
            ),
          );
        const heldIds = new Set(held.map((g) => g.id));
        for (const group of wanted.values()) {
          if (heldIds.has(group.id)) continue;
          await tx.insert(groupMembers).values({
            organizationId,
            groupId: group.id,
            userId: state.userId,
          });
          await record({
            ...event,
            action: "group.member.added",
            targetType: "group",
            targetId: group.id,
            data: { group: group.slug, user: state.userId },
          });
        }
        for (const group of held) {
          if (group.scimGroupId && wanted.has(group.scimGroupId)) continue;
          await tx
            .delete(groupMembers)
            .where(
              and(
                eq(groupMembers.groupId, group.id),
                eq(groupMembers.userId, state.userId),
              ),
            );
          await record({
            ...event,
            action: "group.member.removed",
            targetType: "group",
            targetId: group.id,
            data: { group: group.slug, user: state.userId },
          });
        }
      },
    },
  });

  const findUser = async (id: string) => {
    if (!caller) return undefined;
    const [found] = await tx
      .select({
        id: scimUser.id,
        userId: scimUser.userId,
        active: scimUser.active,
      })
      .from(scimUser)
      .where(
        and(
          eq(scimUser.id, id),
          eq(scimUser.connectionId, caller.connectionId),
        ),
      );
    return found;
  };

  // What a deleted SCIM Group was, before the plugin removes it and its
  // members.
  const findGroup = async (id: string) => {
    if (!caller) return undefined;
    const [source] = await tx
      .select({ externalId: scimGroup.externalId })
      .from(scimGroup)
      .where(
        and(
          eq(scimGroup.id, id),
          eq(scimGroup.connectionId, caller.connectionId),
        ),
      );
    if (!source) return undefined;
    const [{ members = 0 } = {}] = await tx
      .select({ members: count() })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(
        and(
          eq(groups.organizationId, caller.organizationId),
          eq(groups.scimGroupId, id),
        ),
      );
    return { externalId: source.externalId, members };
  };

  const before = async (ctx: HookContext) => {
    caller = await scimCaller(
      tx,
      ctx.headers?.get("authorization") ??
        ctx.request?.headers.get("authorization"),
    );
    const id = param(ctx, "userId");
    if (id) userBefore = await findUser(id);
    const groupId = param(ctx, "groupId");
    if (groupId && ctx.request?.method === "DELETE")
      groupBefore = await findGroup(groupId);
  };

  const after = async (ctx: HookContext) => {
    const method = ctx.request?.method;
    const returned = ctx.context.returned;
    if (!caller || !method || method === "GET") return;
    if (returned instanceof Error) return;
    if (returned instanceof Response && !returned.ok) return;
    const organizationId = caller.organizationId;
    await recordSync(tx, organizationId);
    const createdId =
      typeof (returned as { id?: unknown } | null)?.id === "string"
        ? (returned as { id: string }).id
        : undefined;

    if (ctx.path?.startsWith("/scim/v2/Users")) {
      const id = param(ctx, "userId") ?? createdId;
      const now = method === "DELETE" || !id ? undefined : await findUser(id);
      const subject = now ?? userBefore;
      if (!id || !subject) return;
      let action = "scim.user.updated";
      if (method === "POST") action = "scim.user.provisioned";
      else if (method === "DELETE") action = "scim.user.deleted";
      else if (userBefore?.active && now && !now.active)
        action = "scim.user.deactivated";
      else if (userBefore && !userBefore.active && now?.active)
        action = "scim.user.reactivated";
      await record({
        organizationId,
        ...actor(),
        action,
        targetType: "user",
        targetId: subject.userId,
        data: { scimUser: id, active: now?.active ?? false },
      });
      return;
    }

    if (!ctx.path?.startsWith("/scim/v2/Groups")) return;
    const id = param(ctx, "groupId") ?? createdId;
    if (!id) return;
    if (method === "DELETE") {
      const [removed] = await tx
        .update(groups)
        .set({
          syncedRemovedAt: new Date(),
          syncedRemovedMembers: groupBefore?.members ?? 0,
          ...(groupBefore?.externalId
            ? { scimExternalId: groupBefore.externalId }
            : {}),
        })
        .where(
          and(
            eq(groups.organizationId, organizationId),
            eq(groups.scimGroupId, id),
          ),
        )
        .returning({
          id: groups.id,
          slug: groups.slug,
          removedAt: groups.syncedRemovedAt,
        });
      if (removed?.removedAt)
        await writeOutbox(tx, organizationId, "email", {
          type: "scim.group.removed",
          groupId: removed.id,
          removedAt: removed.removedAt.toISOString(),
        });
      await record({
        organizationId,
        ...actor(),
        action: "scim.group.deleted",
        targetType: "group",
        targetId: removed?.id ?? null,
        data: { scimGroup: id, group: removed?.slug ?? null },
      });
      return;
    }
    const [source] = await tx
      .select({
        displayName: scimGroup.displayName,
        externalId: scimGroup.externalId,
      })
      .from(scimGroup)
      .where(
        and(
          eq(scimGroup.id, id),
          eq(scimGroup.connectionId, caller.connectionId),
        ),
      );
    if (!source) return;
    const group = await syncedGroup(tx, organizationId, id, source.displayName);
    await tx
      .update(groups)
      .set({ scimExternalId: source.externalId })
      .where(
        and(
          eq(groups.id, group.id),
          sql`${groups.scimExternalId} is distinct from ${source.externalId}`,
        ),
      );
    await record({
      organizationId,
      ...actor(),
      action: method === "POST" ? "scim.group.created" : "scim.group.updated",
      targetType: "group",
      targetId: group.id,
      data: { scimGroup: id, group: group.slug, name: group.name },
    });
  };

  // The plugin types its managed-connection tables as optional, which
  // exactOptionalPropertyTypes rejects as a Better Auth plugin schema.
  type Schema = typeof plugin.schema;
  return {
    plugin: plugin as Omit<typeof plugin, "schema"> & {
      schema: { [Table in keyof Schema]-?: NonNullable<Schema[Table]> };
    },
    before,
    after,
  };
};
