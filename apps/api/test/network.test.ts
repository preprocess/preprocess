// A deployment that declares a host the network guardrail blocks waits until
// an Owner or Admin opens it, and every live deployment carries the rules its
// outbound Worker applies.

import { deployments } from "@preprocess/db/schema/deployments";
import { orgId, withOrg, type OrgId } from "@preprocess/db/client";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { Client, createOrganization, signUp, testEnv } from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import networkAgent from "./dist/network-agent.js?raw";

type Deployment = {
  id: string;
  status: string;
  waitingFor: { network?: string[] };
};

let org: OrgId;
let key: Client;

const call = <T>(method: string, path: string, body?: unknown) =>
  key.call<T>(path.replace("{org}", org), {
    method,
    ...(body !== undefined && { body }),
  });

const stored = async (id: string) =>
  (
    await withOrg(testEnv(), org, (tx) =>
      tx
        .select({ status: deployments.status, network: deployments.network })
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
  const { client } = await signUp("Netops");
  org = orgId(await createOrganization(client, "Netco"));
  const created = await client.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "deploy", organizationId: org } },
  );
  key = new Client(testEnv(), {
    authorization: `Bearer ${created.body.key}`,
  });
});

describe("the network guardrail on deployments", () => {
  it("holds a deployment that declares a blocked host until it is opened", async () => {
    await call("PUT", "/v1/orgs/{org}/guardrails/network", {
      allow: [],
      block: ["*.bank.test"],
    });
    const deployed = await call<Deployment>(
      "POST",
      "/v1/orgs/{org}/agents/network-agent/deployments",
      {
        bundle: {
          mainModule: "agent.js",
          modules: { "agent.js": networkAgent },
        },
        git: { branch: "main" },
      },
    );
    expect(deployed.body).toMatchObject({
      status: "waiting",
      waitingFor: { network: ["rates.bank.test"] },
    });
    expect((await stored(deployed.body.id)).network).toEqual({
      allow: [],
      block: ["*.bank.test"],
    });

    await call("PUT", "/v1/orgs/{org}/guardrails/network", {
      allow: ["*.bank.test"],
      block: [],
    });
    const ready = await eventually(
      () => stored(deployed.body.id),
      (d) => d.status === "ready",
    );
    expect(ready.network).toEqual({ allow: ["*.bank.test"], block: [] });
  });
});
