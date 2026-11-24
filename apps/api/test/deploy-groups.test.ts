// Groups named in code (design doc 06, q29): an unknown slug fails the deploy,
// a group without access to the agent holds the deployment in waiting until
// it is granted, and a group a live deployment names is reported in use.

import { orgId, withOrg, type OrgId } from "@preprocess/db/client";
import {
  deploymentGroups,
  deployments,
} from "@preprocess/db/schema/deployments";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { groupInUse } from "../src/deploy.ts";
import { Client, createOrganization, signUp, testEnv } from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import groupsAgent from "./dist/groups-agent.js?raw";

type Deployment = {
  id: string;
  agentId: string;
  status: string;
  promotedAt: string | null;
  waitingFor: { groups?: string[] };
};

let org: OrgId;
let key: Client;

const call = <T>(method: string, path: string, body?: unknown) =>
  key.call<T>(path.replace("{org}", org), {
    method,
    ...(body !== undefined && { body }),
  });

const deploy = () =>
  call<Deployment & { error?: { message: string } }>(
    "POST",
    "/v1/orgs/{org}/agents/contracts/deployments",
    {
      bundle: { mainModule: "agent.js", modules: { "agent.js": groupsAgent } },
      git: { branch: "main" },
    },
  );

const stored = async (id: string) =>
  (
    await withOrg(testEnv(), org, (tx) =>
      tx
        .select({
          status: deployments.status,
          promotedAt: deployments.promotedAt,
        })
        .from(deployments)
        .where(eq(deployments.id, id)),
    )
  )[0]!;

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
  const { client } = await signUp("Groupie");
  org = orgId(await createOrganization(client, "Groupco"));
  const created = await client.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "deploy", organizationId: org } },
  );
  key = new Client(testEnv(), {
    authorization: `Bearer ${created.body.key}`,
  });
});

describe("groups named in code", () => {
  it("fail the deploy when the organization has no such group", async () => {
    const refused = await deploy();
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain("legal");
  });

  it("hold the deployment in waiting until the group has access, then count as in use", async () => {
    const legal = await call<{ id: string }>("POST", "/v1/orgs/{org}/groups", {
      name: "Legal",
      slug: "legal",
    });
    expect(legal.status).toBe(201);
    const other = await call<{ id: string }>("POST", "/v1/orgs/{org}/groups", {
      name: "Finance",
      slug: "finance",
    });

    const deployed = await deploy();
    expect(deployed.status).toBe(201);
    expect(deployed.body).toMatchObject({
      status: "waiting",
      promotedAt: null,
      waitingFor: { groups: ["legal"] },
    });
    const named = await withOrg(testEnv(), org, (tx) =>
      tx
        .select()
        .from(deploymentGroups)
        .where(eq(deploymentGroups.deploymentId, deployed.body.id)),
    );
    expect(named).toMatchObject([{ groupId: legal.body.id, approves: false }]);
    expect(
      (
        await call(
          "POST",
          `/v1/orgs/{org}/agents/contracts/deployments/${deployed.body.id}/promote`,
        )
      ).status,
    ).toBe(409);

    const granted = await call(
      "PUT",
      `/v1/orgs/{org}/agents/${deployed.body.agentId}/grants/${legal.body.id}`,
      { access: "viewer" },
    );
    expect(granted.status).toBe(200);
    await eventually(
      () => stored(deployed.body.id),
      (d) => d.status === "ready",
    );
    const promoted = await call(
      "POST",
      `/v1/orgs/{org}/agents/contracts/deployments/${deployed.body.id}/promote`,
    );
    expect(promoted.status).toBe(200);

    await withOrg(testEnv(), org, async (tx) => {
      expect(await groupInUse(tx, legal.body.id)).toBe(true);
      expect(await groupInUse(tx, legal.body.id, deployed.body.agentId)).toBe(
        true,
      );
      expect(await groupInUse(tx, other.body.id)).toBe(false);
    });
  });
});
