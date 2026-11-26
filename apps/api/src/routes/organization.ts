// The organization's members with their groups, and its plan. Inviting,
// changing roles and removing members are Better Auth's routes
// (/api/auth/organization/*), audited through its hooks.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { withOrg } from "@preprocess/db/client";
import { groupMembers, groups } from "@preprocess/db/schema/access";
import { member, user } from "@preprocess/db/schema/auth";
import { asc, eq } from "drizzle-orm";

import type { OrgVariables } from "../caller.ts";
import type { Env } from "../env.ts";
import { getPlan, paidFeatures } from "../plan.ts";

const OrgParam = z.object({ org: z.string() });

const Member = z
  .object({
    userId: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.enum(["owner", "admin", "member"]),
    joinedAt: z.string(),
    groups: z.array(
      z.object({ id: z.string(), slug: z.string(), name: z.string() }),
    ),
  })
  .openapi("Member");

const PlanSchema = z
  .object({
    name: z.enum(["free", "team", "enterprise", "internal"]),
    features: z.record(z.enum(paidFeatures), z.boolean()),
  })
  .openapi("Plan");

export const organizationRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/members",
      tags: ["Members"],
      request: { params: OrgParam },
      responses: {
        200: {
          content: { "application/json": { schema: z.array(Member) } },
          description: "Members with their role and groups",
        },
      },
    }),
    async (c) => {
      const { members, memberships } = await withOrg(
        c.env,
        c.var.org,
        async (tx) => ({
          members: await tx
            .select({
              userId: member.userId,
              role: member.role,
              joinedAt: member.createdAt,
              name: user.name,
              email: user.email,
            })
            .from(member)
            .innerJoin(user, eq(user.id, member.userId))
            .orderBy(asc(user.name)),
          memberships: await tx
            .select({
              userId: groupMembers.userId,
              id: groups.id,
              slug: groups.slug,
              name: groups.name,
            })
            .from(groupMembers)
            .innerJoin(groups, eq(groups.id, groupMembers.groupId))
            .orderBy(asc(groups.name)),
        }),
      );
      return c.json(
        members.map((m) => ({
          ...m,
          role: m.role as "owner" | "admin" | "member",
          joinedAt: m.joinedAt.toISOString(),
          groups: memberships
            .filter((g) => g.userId === m.userId)
            .map(({ id, slug, name }) => ({ id, slug, name })),
        })),
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/plan",
      tags: ["Organization"],
      request: { params: OrgParam },
      responses: {
        200: {
          content: { "application/json": { schema: PlanSchema } },
          description: "The organization's plan and its paid features",
        },
      },
    }),
    async (c) => {
      const plan = await getPlan(c.env, c.var.org);
      return c.json(
        {
          name: plan.name,
          features: Object.fromEntries(
            paidFeatures.map((f) => [f, plan.has(f)]),
          ) as Record<(typeof paidFeatures)[number], boolean>,
        },
        200,
      );
    },
  );
