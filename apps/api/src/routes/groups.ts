// Groups, their members and per-agent grants (mvp-surface, Identity and
// access). Reads are open to every member; writes need an Owner or Admin.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import {
  agentGrants,
  agents,
  groupMembers,
  groups,
} from "@preprocess/db/schema/access";
import { member, user } from "@preprocess/db/schema/auth";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { trackEvent } from "../analytics.ts";
import { actor, eventBase, requireAdmin } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import type { Env } from "../env.ts";
import { deploymentsNamingGroup, groupInUse, syncAgents } from "../deploy.ts";
import { getPlan } from "../plan.ts";
import { slugify } from "../scim.ts";
import { refuseOverSeats } from "../seats.ts";

const OrgParam = z.object({ org: z.string() });
const GroupParam = OrgParam.extend({ group: z.string() });
const GroupMemberParam = GroupParam.extend({ user: z.string() });
const AgentParam = OrgParam.extend({ agent: z.string() });
const GrantParam = AgentParam.extend({ group: z.string() });

const Group = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isDevelopers: z.boolean(),
    memberCount: z.number(),
    createdAt: z.string(),
    synced: z.boolean().openapi({
      description:
        "Synced from the identity provider: name and members are read-only",
    }),
    syncedRemovedAt: z.string().nullable().openapi({
      description: "When the identity provider deleted the synced group",
    }),
  })
  .openapi("Group");

const GroupMember = z
  .object({
    userId: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.enum(["owner", "admin", "member"]),
    addedAt: z.string(),
  })
  .openapi("GroupMember");

const Grant = z
  .object({
    agentId: z.string(),
    agentSlug: z.string(),
    groupId: z.string(),
    groupSlug: z.string(),
    access: z.enum(["operator", "viewer"]),
    grantedAt: z.string(),
  })
  .openapi("AgentGrant");

const NamingDeployment = z
  .object({
    agentId: z.string(),
    agentSlug: z.string(),
    environment: z.enum(["production", "preview"]),
  })
  .openapi("GroupNamingDeployment");

const GroupDetail = Group.extend({
  members: z.array(GroupMember),
  grants: z.array(Grant),
  namedBy: z.array(NamingDeployment).openapi({
    description:
      "Live deployments whose code names the group, one per agent and environment. While any do, the group can't be deleted.",
  }),
}).openapi("GroupDetail");

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const noContent = { 204: { description: "Done" } };

const SlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,47}$/, "lowercase letters, digits and dashes");

const listGroups = (tx: Tx) =>
  tx
    .select({
      id: groups.id,
      slug: groups.slug,
      name: groups.name,
      description: groups.description,
      isDevelopers: groups.isDevelopers,
      createdAt: groups.createdAt,
      scimGroupId: groups.scimGroupId,
      syncedRemovedAt: groups.syncedRemovedAt,
      memberCount: count(groupMembers.userId),
    })
    .from(groups)
    .leftJoin(groupMembers, eq(groupMembers.groupId, groups.id))
    .groupBy(groups.id)
    .orderBy(asc(groups.name));

const toGroup = ({
  scimGroupId,
  ...g
}: Awaited<ReturnType<typeof listGroups>>[number]) => ({
  ...g,
  createdAt: g.createdAt.toISOString(),
  synced: scimGroupId !== null,
  syncedRemovedAt: g.syncedRemovedAt?.toISOString() ?? null,
});

// A synced group's name and members follow the directory (scim.ts).
const refuseSynced = (
  group: Awaited<ReturnType<typeof findGroup>>,
  what: "name" | "members",
) => {
  if (group.scimGroupId === null || group.syncedRemovedAt) return;
  throw new HTTPException(409, {
    message:
      what === "name"
        ? "This group's name comes from your identity provider. Change it there."
        : "This group's members come from your identity provider. Change them there.",
  });
};

const findGroup = async (tx: Tx, id: string) => {
  const [found] = await listGroups(tx).where(eq(groups.id, id));
  if (!found) throw new HTTPException(404, { message: "No such group." });
  return found;
};

// q29: a group a live deployment's code names, or its access to that agent,
// stays until the code stops naming it.
const refuseInUse = async (
  tx: Tx,
  groupId: string,
  slug: string,
  agentIds: string[],
  what: string,
) => {
  const using: string[] = [];
  for (const id of agentIds)
    if (await groupInUse(tx, groupId, id)) using.push(id);
  if (using.length === 0) return;
  const named = await tx
    .select({ slug: agents.slug })
    .from(agents)
    .where(inArray(agents.id, using))
    .orderBy(asc(agents.slug));
  throw new HTTPException(409, {
    message: `${what}: live deployments of ${named.map((a) => a.slug).join(", ")} name the group ${slug}. Deploy code that stops naming it first.`,
  });
};

const grantsOf = (tx: Tx) =>
  tx
    .select({
      agentId: agentGrants.agentId,
      agentSlug: agents.slug,
      groupId: agentGrants.groupId,
      groupSlug: groups.slug,
      access: agentGrants.access,
      grantedAt: agentGrants.grantedAt,
    })
    .from(agentGrants)
    .innerJoin(agents, eq(agents.id, agentGrants.agentId))
    .innerJoin(groups, eq(groups.id, agentGrants.groupId));

const toGrant = (g: Awaited<ReturnType<typeof grantsOf>>[number]) => ({
  ...g,
  grantedAt: g.grantedAt.toISOString(),
});

const isUniqueViolation = (error: unknown) =>
  (error as { cause?: { code?: string } }).cause?.code === "23505";

export const groupRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/groups",
      tags: ["Groups"],
      request: { params: OrgParam },
      responses: { 200: json(z.array(Group), "The organization's groups") },
    }),
    async (c) => {
      const rows = await withOrg(c.env, c.var.org, (tx) => listGroups(tx));
      return c.json(rows.map(toGroup), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/groups",
      tags: ["Groups"],
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                name: z.string().trim().min(1).max(80),
                slug: SlugSchema.optional(),
                description: z.string().max(500).optional(),
              }),
            },
          },
        },
      },
      responses: {
        201: json(Group, "Created"),
        409: { description: "A group with that slug exists" },
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const body = c.req.valid("json");
      const slug = body.slug ?? slugify(body.name);
      if (!slug)
        throw new HTTPException(400, { message: "Give the group a slug." });
      const id = newId("group");
      const created = await withOrg(c.env, c.var.org, async (tx) => {
        await tx.insert(groups).values({
          id,
          organizationId: c.var.org,
          slug,
          name: body.name,
          description: body.description ?? null,
        });
        await audit(tx, {
          ...eventBase(c.var),
          action: "group.created",
          targetType: "group",
          targetId: id,
          data: { slug, name: body.name },
        });
        return findGroup(tx, id);
      }).catch((error: unknown) => {
        if (isUniqueViolation(error))
          throw new HTTPException(409, {
            message: `A group with the slug "${slug}" already exists.`,
          });
        throw error;
      });
      await trackEvent(
        c.env,
        "group_created",
        c.var.org,
        c.var.caller.type === "person" ? c.var.caller.userId : null,
        { group_id: id },
      );
      return c.json(toGroup(created), 201);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/groups/{group}",
      tags: ["Groups"],
      request: { params: GroupParam },
      responses: {
        200: json(GroupDetail, "The group with its members and grants"),
      },
    }),
    async (c) => {
      const id = c.req.valid("param").group;
      const detail = await withOrg(c.env, c.var.org, async (tx) => {
        const group = await findGroup(tx, id);
        const members = await tx
          .select({
            userId: user.id,
            name: user.name,
            email: user.email,
            role: member.role,
            addedAt: groupMembers.addedAt,
          })
          .from(groupMembers)
          .innerJoin(user, eq(user.id, groupMembers.userId))
          .innerJoin(
            member,
            and(
              eq(member.userId, groupMembers.userId),
              eq(member.organizationId, groupMembers.organizationId),
            ),
          )
          .where(eq(groupMembers.groupId, id))
          .orderBy(asc(user.name));
        const grants = await grantsOf(tx).where(eq(agentGrants.groupId, id));
        const namedBy = await deploymentsNamingGroup(tx, id);
        return { group, members, grants, namedBy };
      });
      return c.json(
        {
          ...toGroup(detail.group),
          members: detail.members.map((m) => ({
            ...m,
            role: m.role as "owner" | "admin" | "member",
            addedAt: m.addedAt.toISOString(),
          })),
          grants: detail.grants.map(toGrant),
          namedBy: detail.namedBy,
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/groups/{group}",
      tags: ["Groups"],
      request: {
        params: GroupParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                name: z.string().trim().min(1).max(80).optional(),
                description: z.string().max(500).nullable().optional(),
              }),
            },
          },
        },
      },
      responses: { 200: json(Group, "Updated") },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const id = c.req.valid("param").group;
      const body = c.req.valid("json");
      const updated = await withOrg(c.env, c.var.org, async (tx) => {
        const before = await findGroup(tx, id);
        if (body.name !== undefined && body.name !== before.name)
          refuseSynced(before, "name");
        await tx
          .update(groups)
          .set({
            name: body.name ?? before.name,
            description:
              body.description === undefined
                ? before.description
                : body.description,
          })
          .where(eq(groups.id, id));
        await audit(tx, {
          ...eventBase(c.var),
          action: "group.updated",
          targetType: "group",
          targetId: id,
          data: { slug: before.slug, fields: Object.keys(body) },
        });
        return findGroup(tx, id);
      });
      return c.json(toGroup(updated), 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/groups/{group}",
      tags: ["Groups"],
      request: { params: GroupParam },
      responses: {
        ...noContent,
        409: { description: "The group is in use" },
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const id = c.req.valid("param").group;
      await withOrg(c.env, c.var.org, async (tx) => {
        const group = await findGroup(tx, id);
        if (group.isDevelopers)
          throw new HTTPException(409, {
            message: "The Developers group cannot be deleted.",
          });
        if (group.scimGroupId !== null && !group.syncedRemovedAt)
          throw new HTTPException(409, {
            message:
              "This group comes from your identity provider. Delete it there.",
          });
        await refuseInUse(
          tx,
          id,
          group.slug,
          (await tx.select({ id: agents.id }).from(agents)).map((a) => a.id),
          "The group cannot be deleted",
        );
        const [grant] = await grantsOf(tx)
          .where(eq(agentGrants.groupId, id))
          .limit(1);
        if (grant)
          throw new HTTPException(409, {
            message: `Remove the group's access to ${grant.agentSlug} first.`,
          });
        await tx.delete(groups).where(eq(groups.id, id));
        await audit(tx, {
          ...eventBase(c.var),
          action: "group.deleted",
          targetType: "group",
          targetId: id,
          data: { slug: group.slug },
        });
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/groups/{group}/members/{user}",
      tags: ["Groups"],
      request: { params: GroupMemberParam },
      responses: {
        ...noContent,
        400: { description: "Not a member" },
        402: { description: "Past the license's seat limit" },
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const { group: id, user: userId } = c.req.valid("param");
      const plan = await getPlan(c.env, c.var.org);
      await withOrg(c.env, c.var.org, async (tx) => {
        const group = await findGroup(tx, id);
        refuseSynced(group, "members");
        const [membership] = await tx
          .select({ id: member.id })
          .from(member)
          .where(eq(member.userId, userId));
        if (!membership)
          throw new HTTPException(400, {
            message: "Only members of the organization can join its groups.",
          });
        await refuseOverSeats(tx, plan, { group: id, user: userId });
        const added = await tx
          .insert(groupMembers)
          .values({ organizationId: c.var.org, groupId: id, userId })
          .onConflictDoNothing()
          .returning();
        if (added.length === 0) return;
        await audit(tx, {
          ...eventBase(c.var),
          action: "group.member.added",
          targetType: "group",
          targetId: id,
          data: { group: group.slug, user: userId },
        });
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/groups/{group}/members/{user}",
      tags: ["Groups"],
      request: { params: GroupMemberParam },
      responses: noContent,
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const { group: id, user: userId } = c.req.valid("param");
      await withOrg(c.env, c.var.org, async (tx) => {
        const group = await findGroup(tx, id);
        refuseSynced(group, "members");
        const removed = await tx
          .delete(groupMembers)
          .where(
            and(eq(groupMembers.groupId, id), eq(groupMembers.userId, userId)),
          )
          .returning();
        if (removed.length === 0) return;
        await audit(tx, {
          ...eventBase(c.var),
          action: "group.member.removed",
          targetType: "group",
          targetId: id,
          data: { group: group.slug, user: userId },
        });
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/agents/{agent}/grants",
      tags: ["Agent access"],
      request: { params: AgentParam },
      responses: {
        200: json(z.array(Grant), "Groups with access to the agent"),
      },
    }),
    async (c) => {
      const agentId = c.req.valid("param").agent;
      const rows = await withOrg(c.env, c.var.org, (tx) =>
        grantsOf(tx).where(eq(agentGrants.agentId, agentId)),
      );
      return c.json(rows.map(toGrant), 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/agents/{agent}/grants/{group}",
      tags: ["Agent access"],
      request: {
        params: GrantParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({ access: z.enum(["operator", "viewer"]) }),
            },
          },
        },
      },
      responses: {
        200: json(Grant, "The grant"),
        402: { description: "Operator access past the license's seat limit" },
        409: { description: "Lowering the access of a group live code names" },
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const { agent: agentId, group: groupId } = c.req.valid("param");
      const { access } = c.req.valid("json");
      const plan = await getPlan(c.env, c.var.org);
      const grant = await withOrg(c.env, c.var.org, async (tx) => {
        const [agent] = await tx
          .select()
          .from(agents)
          .where(eq(agents.id, agentId));
        if (!agent) throw new HTTPException(404, { message: "No such agent." });
        const group = await findGroup(tx, groupId);
        if (group.isDevelopers)
          throw new HTTPException(400, {
            message: "The Developers group already manages every agent.",
          });
        const [current] = await tx
          .select({ access: agentGrants.access })
          .from(agentGrants)
          .where(
            and(
              eq(agentGrants.agentId, agentId),
              eq(agentGrants.groupId, groupId),
            ),
          );
        if (current?.access === "operator" && access === "viewer")
          await refuseInUse(
            tx,
            groupId,
            group.slug,
            [agentId],
            "The group's access cannot be lowered",
          );
        if (access === "operator")
          await refuseOverSeats(tx, plan, { group: groupId });
        await tx
          .insert(agentGrants)
          .values({
            organizationId: c.var.org,
            agentId,
            groupId,
            access,
            grantedBy: actor(c.var.caller).actorId,
          })
          .onConflictDoUpdate({
            target: [agentGrants.agentId, agentGrants.groupId],
            set: { access },
          });
        await audit(tx, {
          ...eventBase(c.var),
          action: "agent.access.granted",
          targetType: "agent",
          targetId: agentId,
          data: { agent: agent.slug, group: group.slug, access },
        });
        const [row] = await grantsOf(tx).where(
          and(
            eq(agentGrants.agentId, agentId),
            eq(agentGrants.groupId, groupId),
          ),
        );
        // Live deployments waiting for this group's access are re-checked.
        await syncAgents(tx, c.var.org, [agentId]);
        return row!;
      });
      await trackEvent(
        c.env,
        "grant_changed",
        c.var.org,
        c.var.caller.type === "person" ? c.var.caller.userId : null,
        { agent_id: agentId, group_id: groupId, access },
      );
      return c.json(toGrant(grant), 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/agents/{agent}/grants/{group}",
      tags: ["Agent access"],
      request: { params: GrantParam },
      responses: {
        ...noContent,
        409: { description: "The group is named by live code" },
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const { agent: agentId, group: groupId } = c.req.valid("param");
      const revoked = await withOrg(c.env, c.var.org, async (tx) => {
        const group = await findGroup(tx, groupId);
        await refuseInUse(
          tx,
          groupId,
          group.slug,
          [agentId],
          "The group's access cannot be removed",
        );
        const removed = await tx
          .delete(agentGrants)
          .where(
            and(
              eq(agentGrants.agentId, agentId),
              eq(agentGrants.groupId, groupId),
            ),
          )
          .returning();
        if (removed.length === 0) return false;
        await audit(tx, {
          ...eventBase(c.var),
          action: "agent.access.revoked",
          targetType: "agent",
          targetId: agentId,
          data: { group: groupId },
        });
        return true;
      });
      if (revoked)
        await trackEvent(
          c.env,
          "grant_changed",
          c.var.org,
          c.var.caller.type === "person" ? c.var.caller.userId : null,
          { agent_id: agentId, group_id: groupId, access: "none" },
        );
      return c.body(null, 204);
    },
  );
