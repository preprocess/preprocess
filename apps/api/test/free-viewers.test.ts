// People who lost a seat when Team ended keep viewer access through the
// Viewers group (PRE-96), including to agents created after the switch.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agentGrants, agents, groups } from "@preprocess/db/schema/access";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { agentRole } from "../src/access.ts";
import type { Caller } from "../src/caller.ts";

import { addMember, createOrganization, signUp, testEnv } from "./helpers.ts";
import scheduledAgent from "./dist/scheduled-agent.js?raw";

const env = testEnv();

const deploy = (
  who: Awaited<ReturnType<typeof signUp>>["client"],
  org: string,
  agent: string,
) =>
  who.call(`/v1/orgs/${org}/agents/${agent}/deployments`, {
    body: {
      bundle: {
        mainModule: "agent.js",
        modules: { "agent.js": scheduledAgent },
      },
      git: { branch: "main", commit: "0000000" },
    },
  });

describe("the Viewers group", () => {
  it("can view an agent created after the switch", async () => {
    const owner = await signUp("Vera Owner", env);
    const org = await createOrganization(owner.client, "Viewco");
    const viewer = await addMember(owner.client, org, "Val Viewer");

    expect((await deploy(owner.client, org, "before")).status).toBe(201);
    const viewersGroup = await withOrg(env, orgId(org), async (tx) => {
      const id = newId("group");
      await tx.insert(groups).values({
        id,
        organizationId: org,
        slug: "free-viewers",
        name: "Viewers",
      });
      return id;
    });
    expect(
      (
        await owner.client.call(
          `/v1/orgs/${org}/groups/${viewersGroup}/members/${viewer.userId}`,
          { method: "PUT" },
        )
      ).status,
    ).toBe(204);

    expect((await deploy(owner.client, org, "after")).status).toBe(201);
    const grants = await withOrg(env, orgId(org), (tx) =>
      tx
        .select({ access: agentGrants.access })
        .from(agentGrants)
        .where(eq(agentGrants.groupId, viewersGroup)),
    );
    expect(grants).toEqual([{ access: "viewer" }]);
    // The switch grants the agents that existed then; this one predates it
    // and was never granted here, so only the new agent is visible.
    const role = (slug: string) =>
      withOrg(env, orgId(org), async (tx) => {
        const [agent] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(eq(agents.slug, slug));
        const caller = {
          type: "person",
          userId: viewer.userId,
          role: "member",
        } as Caller;
        return agentRole(tx, caller, agent!.id);
      });
    expect(await role("after")).toBe("viewer");
    expect(await role("before")).toBeNull();
  });
});
