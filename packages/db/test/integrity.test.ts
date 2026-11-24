import { env } from "cloudflare:workers";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { withOrg, withoutOrg } from "../src/client.ts";
import { newId } from "../src/ids.ts";
import { groupMembers, groups } from "../src/schema/access.ts";
import { member, organization, user } from "../src/schema/auth.ts";
import { cases } from "../src/schema/cases.ts";
import { deploymentGroups, deployments } from "../src/schema/deployments.ts";
import { failure, seedOrganization } from "./fixtures.ts";
import type { Org } from "./fixtures.ts";

let a: Org;
let b: Org;

beforeAll(async () => {
  a = await seedOrganization("Initech");
  b = await seedOrganization("Umbrella");
});

describe("groups", () => {
  it("only take members of their organization", async () => {
    expect(
      await failure(
        withOrg(env, a.org, (tx) =>
          tx.insert(groupMembers).values({
            organizationId: a.org,
            groupId: a.groupId,
            userId: b.userId,
          }),
        ),
      ),
    ).toMatch(/not a member/);
  });

  it("lose a person who leaves the organization", async () => {
    const userId = newId("user");
    await withoutOrg(env, "test fixture", async (tx) => {
      await tx.insert(user).values({
        id: userId,
        name: "Leaver",
        email: `${userId}@initech.test`,
      });
      await tx.insert(member).values({
        id: newId("member"),
        organizationId: a.org,
        userId,
        role: "member",
        createdAt: new Date(),
      });
      await tx
        .insert(groupMembers)
        .values({ organizationId: a.org, groupId: a.groupId, userId });
      await tx
        .delete(member)
        .where(
          and(eq(member.organizationId, a.org), eq(member.userId, userId)),
        );
    });
    const left = await withOrg(env, a.org, (tx) =>
      tx.select().from(groupMembers).where(eq(groupMembers.userId, userId)),
    );
    expect(left).toEqual([]);
  });

  it("keep the Developers group", async () => {
    expect(
      await failure(
        withOrg(env, a.org, (tx) =>
          tx.delete(groups).where(eq(groups.id, a.developersId)),
        ),
      ),
    ).toMatch(/Developers group cannot be deleted/);
    expect(
      await failure(
        withOrg(env, a.org, (tx) =>
          tx
            .update(groups)
            .set({ isDevelopers: false })
            .where(eq(groups.id, a.developersId)),
        ),
      ),
    ).toMatch(/is_developers cannot change/);
    expect(
      await failure(
        withOrg(env, a.org, (tx) =>
          tx.insert(groups).values({
            id: newId("group"),
            organizationId: a.org,
            slug: "devs-2",
            name: "Devs 2",
            isDevelopers: true,
          }),
        ),
      ),
    ).toMatch(/one_developers_group/);
  });

  it("refuse deleting a group that has a grant", async () => {
    expect(
      await failure(
        withOrg(env, a.org, (tx) =>
          tx.delete(groups).where(eq(groups.id, a.groupId)),
        ),
      ),
    ).toMatch(/foreign key/);
  });
});

describe("deployments", () => {
  it("serve only their own organization's cases", async () => {
    expect(
      await failure(
        withOrg(env, a.org, (tx) =>
          tx.insert(cases).values({
            id: newId("case"),
            organizationId: a.org,
            agentId: a.agentId,
            deploymentId: b.deploymentId,
            status: "queued",
            source: "api",
          }),
        ),
      ),
    ).toMatch(/foreign key/);
  });

  it("cannot be deleted while a case points at them", async () => {
    expect(
      await failure(
        withOrg(env, a.org, (tx) =>
          tx.delete(deployments).where(eq(deployments.id, a.deploymentId)),
        ),
      ),
    ).toMatch(/foreign key/);
  });

  it("name only their own organization's groups", async () => {
    expect(
      await failure(
        withOrg(env, a.org, (tx) =>
          tx.insert(deploymentGroups).values({
            organizationId: a.org,
            deploymentId: a.deploymentId,
            groupId: b.groupId,
          }),
        ),
      ),
    ).toMatch(/foreign key/);
  });

  it("promote only production", async () => {
    expect(
      await failure(
        withOrg(env, a.org, (tx) =>
          tx
            .update(deployments)
            .set({ environment: "preview" })
            .where(eq(deployments.id, a.deploymentId)),
        ),
      ),
    ).toMatch(/deployments_only_production_is_promoted/);
  });
});

describe("roles", () => {
  it("are only owner, admin and member", async () => {
    expect(
      await failure(
        withoutOrg(env, "test fixture", (tx) =>
          tx
            .update(member)
            .set({ role: "viewer" })
            .where(eq(member.organizationId, a.org)),
        ),
      ),
    ).toMatch(/member_role_fixed/);
  });
});

describe("deleting an organization", () => {
  it("removes its tenant rows and keeps its audit chain", async () => {
    const doomed = await seedOrganization("Doomed");
    await withoutOrg(env, "test fixture", (tx) =>
      tx.delete(organization).where(eq(organization.id, doomed.org)),
    );
    const left = await withoutOrg(env, "test check", (tx) =>
      tx.execute<{ groups: number; events: number }>(sql`
        select (select count(*)::int from groups where organization_id = ${doomed.org}) as groups,
               (select count(*)::int from audit_events where organization_id = ${doomed.org}) as events`),
    );
    expect(left.rows[0]).toEqual({ groups: 0, events: 1 });
    expect(b.org).not.toBe(doomed.org);
  });
});
