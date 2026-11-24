// q29: a group a live deployment's code names, or its access to that agent,
// cannot be deleted, revoked or lowered; the refusal names the agents.

import { orgId, type OrgId } from "@preprocess/db/client";
import { beforeAll, describe, expect, it } from "vitest";

import { Client, createOrganization, signUp, testEnv } from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import groupsAgent from "./dist/groups-agent.js?raw";

let org: OrgId;
let key: Client;
let agentId: string;
let legal: string;
let finance: string;

const call = <T = { error?: string }>(
  method: string,
  path: string,
  body?: unknown,
) =>
  key.call<T>(path.replace("{org}", org), {
    method,
    ...(body !== undefined && { body }),
  });

const grant = (group: string, access?: "operator" | "viewer") =>
  access
    ? call("PUT", `/v1/orgs/{org}/agents/${agentId}/grants/${group}`, {
        access,
      })
    : call("DELETE", `/v1/orgs/{org}/agents/${agentId}/grants/${group}`);

beforeAll(async () => {
  const { client } = await signUp("Keeper");
  org = orgId(await createOrganization(client, "Keepco"));
  const created = await client.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "deploy", organizationId: org } },
  );
  key = new Client(testEnv(), {
    authorization: `Bearer ${created.body.key}`,
  });
  const group = async (slug: string) =>
    (
      await call<{ id: string }>("POST", "/v1/orgs/{org}/groups", {
        name: slug,
        slug,
      })
    ).body.id;
  legal = await group("legal");
  finance = await group("finance");
  const deployed = await call<{ agentId: string; promotedAt: string | null }>(
    "POST",
    "/v1/orgs/{org}/agents/contracts/deployments",
    {
      bundle: { mainModule: "agent.js", modules: { "agent.js": groupsAgent } },
      git: { branch: "main" },
    },
  );
  agentId = deployed.body.agentId;
  expect((await grant(legal, "operator")).status).toBe(200);
  // Redeployed with access, so the production deployment names legal.
  const live = await call<{ promotedAt: string | null }>(
    "POST",
    "/v1/orgs/{org}/agents/contracts/deployments",
    {
      bundle: { mainModule: "agent.js", modules: { "agent.js": groupsAgent } },
      git: { branch: "main" },
    },
  );
  expect(live.body.promotedAt).not.toBeNull();
});

describe("a group live code names", () => {
  it("keeps its access to the agent", async () => {
    const lowered = await grant(legal, "viewer");
    expect(lowered.status).toBe(409);
    expect(lowered.body.error).toContain("contracts");
    const revoked = await grant(legal);
    expect(revoked.status).toBe(409);
    expect(revoked.body.error).toContain("contracts");
    expect((await grant(legal, "operator")).status).toBe(200);
  });

  it("cannot be deleted", async () => {
    const deleted = await call("DELETE", `/v1/orgs/{org}/groups/${legal}`);
    expect(deleted.status).toBe(409);
    expect(deleted.body.error).toContain("contracts");
  });

  it("does not hold a group the code does not name", async () => {
    expect((await grant(finance, "operator")).status).toBe(200);
    expect((await grant(finance, "viewer")).status).toBe(200);
    expect((await grant(finance)).status).toBe(204);
    expect(
      (await call("DELETE", `/v1/orgs/{org}/groups/${finance}`)).status,
    ).toBe(204);
  });
});
