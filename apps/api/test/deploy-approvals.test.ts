// Groups code names to approve (spec §9): they need operator access, so a
// deploy whose approving group is only a viewer waits, and the deployment
// records which groups approve.

import { orgId, withOrg, type OrgId } from "@preprocess/db/client";
import { deploymentGroups } from "@preprocess/db/schema/deployments";
import { groups } from "@preprocess/db/schema/access";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { Client, createOrganization, signUp, testEnv } from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import approvalsAgent from "./dist/approvals-agent.js?raw";

type Deployment = {
  id: string;
  agentId: string;
  status: string;
  waitingFor: { groups?: string[] };
};

let org: OrgId;
let key: Client;

const call = <T>(method: string, path: string, body?: unknown) =>
  key.call<T>(path.replace("{org}", org), {
    method,
    ...(body !== undefined && { body }),
  });

const status = async (id: string) =>
  (
    await call<Deployment>(
      "GET",
      `/v1/orgs/{org}/agents/payables/deployments/${id}`,
    )
  ).body;

const eventually = async <T>(
  read: () => Promise<T>,
  done: (v: T) => boolean,
) => {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting");
};

beforeAll(async () => {
  const { client } = await signUp("Approver");
  org = orgId(await createOrganization(client, "Payco"));
  const created = await client.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "deploy", organizationId: org } },
  );
  key = new Client(testEnv(), { authorization: `Bearer ${created.body.key}` });
});

describe("approving groups", () => {
  it("wait for operator access, and are recorded as approving", async () => {
    const legal = await call<{ id: string }>("POST", "/v1/orgs/{org}/groups", {
      name: "Legal",
      slug: "legal",
    });
    const finance = await call<{ id: string }>(
      "POST",
      "/v1/orgs/{org}/groups",
      {
        name: "Finance",
        slug: "finance",
      },
    );
    const deployed = await call<Deployment>(
      "POST",
      "/v1/orgs/{org}/agents/payables/deployments",
      {
        bundle: {
          mainModule: "agent.js",
          modules: { "agent.js": approvalsAgent },
        },
        git: { branch: "main" },
      },
    );
    expect(deployed.status).toBe(201);
    const agent = deployed.body.agentId;
    for (const group of [legal.body.id, finance.body.id])
      expect(
        (
          await call("PUT", `/v1/orgs/{org}/agents/${agent}/grants/${group}`, {
            access: "viewer",
          })
        ).status,
      ).toBe(200);

    // A viewer may be waited on, never approve.
    const waiting = await eventually(
      () => status(deployed.body.id),
      (d) => d.waitingFor.groups?.join() === "finance",
    );
    expect(waiting.status).toBe("waiting");
    const named = await withOrg(testEnv(), org, (tx) =>
      tx
        .select({ slug: groups.slug, approves: deploymentGroups.approves })
        .from(deploymentGroups)
        .innerJoin(groups, eq(groups.id, deploymentGroups.groupId))
        .where(eq(deploymentGroups.deploymentId, deployed.body.id)),
    );
    expect(named.sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([
      { slug: "finance", approves: true },
      { slug: "legal", approves: false },
    ]);

    await call(
      "PUT",
      `/v1/orgs/{org}/agents/${agent}/grants/${finance.body.id}`,
      {
        access: "operator",
      },
    );
    await eventually(
      () => status(deployed.body.id),
      (d) => d.status === "ready",
    );
  });
});
