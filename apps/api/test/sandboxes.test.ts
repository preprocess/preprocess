// Developers › Sandboxes (spec 3): the read-only rollup of which agents declare
// a sandbox, the size each asks for, whether a larger size waits on the
// guardrail, and tenant isolation of the list.

import { orgId, type OrgId } from "@preprocess/db/client";
import { beforeAll, describe, expect, it } from "vitest";

import type { Client } from "./helpers.ts";
import { createOrganization, signUp, testEnv } from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import sampleAgent from "./dist/sample-agent.js?raw";
import sandboxAgent from "./dist/sandbox-agent.js?raw";

type Sandboxes = {
  maxSize: string | null;
  customEnvironments: boolean;
  sizes: { size: string; vcpu: number; memoryGib: number; diskGb: number }[];
  agents: {
    slug: string;
    preset: string;
    size: string;
    packages: number;
    waiting: boolean;
    paused: boolean;
    environment: unknown;
  }[];
};

const environment = testEnv();
let owner: Client;
let org: OrgId;

const deploy = (
  client: Client,
  organization: OrgId,
  slug: string,
  module: string,
) =>
  client.call<{ id: string }>(
    `/v1/orgs/${organization}/agents/${slug}/deployments`,
    {
      method: "POST",
      body: {
        bundle: { mainModule: "agent.js", modules: { "agent.js": module } },
        git: { branch: "main" },
      },
    },
  );

const sandboxes = async (client: Client, organization: OrgId) =>
  client.call<Sandboxes>(`/v1/orgs/${organization}/sandboxes`);

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
  owner = (await signUp("Sandbox lister", environment)).client;
  org = orgId(await createOrganization(owner, "Sandlist"));
});

describe("GET /sandboxes", () => {
  it("lists sizes and no agents before any deploy", async () => {
    const empty = await sandboxes(owner, org);
    expect(empty.status).toBe(200);
    expect(empty.body.agents).toEqual([]);
    expect(empty.body.maxSize).toBeNull();
    expect(empty.body.sizes).toEqual([
      { size: "small", vcpu: 0.5, memoryGib: 4, diskGb: 8 },
      { size: "medium", vcpu: 1, memoryGib: 6, diskGb: 12 },
      { size: "large", vcpu: 4, memoryGib: 12, diskGb: 20 },
    ]);
  });

  it("lists agents that declare a sandbox, waiting when the size passes the guardrail", async () => {
    await owner.call(`/v1/orgs/${org}/guardrails/sandbox-size`, {
      method: "PUT",
      body: { size: "medium" },
    });
    expect((await deploy(owner, org, "plain", sampleAgent)).status).toBe(201);
    const deployed = await deploy(owner, org, "reconciler", sandboxAgent);
    expect(deployed.status).toBe(201);
    const listed = await eventually(
      () => sandboxes(owner, org),
      (r) => r.body.agents.some((a) => a.waiting),
    );
    expect(listed.body.maxSize).toBe("medium");
    expect(listed.body.agents).toEqual([
      {
        id: expect.any(String) as string,
        slug: "reconciler",
        preset: "python-data",
        size: "large",
        packages: 1,
        waiting: true,
        paused: false,
        environment: null,
      },
    ]);
  });

  it("never shows another organization's agents", async () => {
    const other = (await signUp("Other lister", environment)).client;
    const otherOrg = orgId(await createOrganization(other, "Elsewhere"));
    const theirs = await sandboxes(other, otherOrg);
    expect(theirs.status).toBe(200);
    expect(theirs.body.agents).toEqual([]);
    expect((await sandboxes(other, org)).status).toBe(403);
  });
});
