// Custom sandbox environments (spec 3): the Team entitlement, a deploy that
// builds before it serves, the disk-fit refusal that names a size that fits,
// the large-layer warning, tenant isolation of layer keys, layers counted as
// stored bytes, and collection of layers no live deployment names. The
// runtime's build itself is stubbed: tests have no containers.

import { orgId, withOrg, withoutOrg, type OrgId } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { deployments, sandboxLayers } from "@preprocess/db/schema/deployments";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { storedBytes } from "../src/billing.ts";
import type { Env, Runtime, SandboxLayerJob } from "../src/env.ts";
import {
  collectSandboxLayers,
  deploymentLayer,
  fittingSize,
  layerBuilt,
  ownsLayer,
} from "../src/sandbox-layers.ts";
import type { Client } from "./helpers.ts";
import { createOrganization, signUp, testEnv } from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import setupAgent from "./dist/setup-agent.js?raw";

type View = {
  id: string;
  status: string;
  production: boolean;
  warnings: string[];
  sandboxEnvironment: {
    status: string;
    bytes?: number;
    error?: string;
  } | null;
};

const queued: { job: SandboxLayerJob; deploymentId: string }[] = [];
const deleted: string[] = [];
const real = (env as unknown as { RUNTIME: Runtime }).RUNTIME;
const runtime = new Proxy(real, {
  get: (target, name: keyof Runtime) => {
    if (name === "queueSandboxLayer")
      return (job: SandboxLayerJob, d: { deploymentId: string }) => {
        queued.push({ job, deploymentId: d.deploymentId });
        return Promise.resolve();
      };
    if (name === "deleteSandboxLayer")
      return (_org: string, key: string) => {
        deleted.push(key);
        return Promise.resolve(true);
      };
    return (...args: unknown[]) =>
      (target[name] as (...a: unknown[]) => unknown)(...args);
  },
});

const environment: Env = testEnv({
  AUTUMN_SECRET_KEY: "am_sk_test_stub",
  RUNTIME: runtime,
});

// The billing service's answer for every organization: the plan's flags.
let flags: Record<string, object> = {};
const stubPlan = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.useautumn.com")
      throw new Error(`unexpected fetch to ${url.hostname}`);
    const body = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    ) as Record<string, unknown>;
    const route = url.pathname.replace("/v1/", "");
    return Promise.resolve(
      Response.json(
        route === "customers.get_or_create"
          ? {
              id: body.customer_id,
              subscriptions: [{ plan_id: "team", status: "active" }],
              flags,
              balances: {},
            }
          : route === "check"
            ? { allowed: true }
            : {},
      ),
    );
  });

afterEach(() => {
  vi.restoreAllMocks();
});

const hash = (c: string) => c.repeat(64);
const key = (org: string, c = "a") => `org/${org}/layers/${hash(c)}`;

let owner: Client;
let org: OrgId;

const deploy = (branch = "main") =>
  owner.call<View & { message?: string; error?: string }>(
    `/v1/orgs/${org}/agents/parser/deployments`,
    {
      method: "POST",
      body: {
        bundle: { mainModule: "agent.js", modules: { "agent.js": setupAgent } },
        git: { branch },
      },
    },
  );

const read = async (id: string) =>
  (await owner.call<View>(`/v1/orgs/${org}/agents/parser/deployments/${id}`))
    .body;

const ref = async (deploymentId: string) => {
  const [d] = await withOrg(environment, org, (tx) =>
    tx.select().from(deployments).where(eq(deployments.id, deploymentId)),
  );
  return {
    organizationId: org as string,
    agentId: d!.agentId,
    deploymentId,
  };
};

const built = (bytes: number, c = "a") => ({
  key: key(org, c),
  image: "registry.example/sandbox-python@sha256:1",
  bytes,
  unpackedBytes: bytes * 3,
});

beforeAll(async () => {
  owner = (await signUp("Layer Owner", environment)).client;
  org = orgId(await createOrganization(owner, "Layerco"));
});

describe("deploying a custom environment", () => {
  it("is refused without the custom_sandbox_images entitlement", async () => {
    flags = {};
    stubPlan();
    const free = (await signUp("Preset Owner", environment)).client;
    const freeOrg = await createOrganization(free, "Presetonly");
    const res = await free.call(
      `/v1/orgs/${freeOrg}/agents/parser/deployments`,
      {
        method: "POST",
        body: {
          bundle: {
            mainModule: "agent.js",
            modules: { "agent.js": setupAgent },
          },
          git: { branch: "main" },
        },
      },
    );
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain("Team plan or above");
  });

  it("builds first, then serves and is promoted once the layer fits", async () => {
    flags = { custom_sandbox_images: {} };
    stubPlan();
    const res = await deploy();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      status: "building",
      production: false,
      sandboxEnvironment: { status: "building" },
    });
    const job = queued.find((q) => q.deploymentId === res.body.id)?.job;
    expect(job).toMatchObject({
      organizationId: org,
      preset: "python",
      setup: {
        packages: { apt: [], pip: ["requests==2.32.3"], npm: [] },
        run: ["python3 -c 'import requests'"],
        files: { "config.json": "{}" },
        env: { APP_MODE: "test" },
      },
    });
    const promote = await owner.call(
      `/v1/orgs/${org}/agents/parser/deployments/${res.body.id}/promote`,
      { method: "POST" },
    );
    expect(promote.status).toBe(409);

    expect(
      await layerBuilt(environment, {
        deployment: await ref(res.body.id),
        result: built(50_000_000),
      }),
    ).toEqual({ ok: true });
    expect(await read(res.body.id)).toMatchObject({
      status: "ready",
      production: true,
      sandboxEnvironment: { status: "ready", bytes: 50_000_000 },
    });
    expect(
      await deploymentLayer(environment, await ref(res.body.id)),
    ).toMatchObject({ key: key(org), bytes: 50_000_000 });
  });

  it("fails when the layer and preset outgrow the size's disk, naming a size that fits", async () => {
    flags = { custom_sandbox_images: {} };
    stubPlan();
    const res = await deploy("big");
    const result = await layerBuilt(environment, {
      deployment: await ref(res.body.id),
      result: built(7_900_000_000, "b"),
    });
    expect(result).toEqual({
      error:
        'the custom environment (7.9 GB) and the python preset (0.3 GB) do not fit a small sandbox\'s 8.0 GB disk; set sandbox.size to "medium"',
    });
    expect(await read(res.body.id)).toMatchObject({
      status: "failed",
      sandboxEnvironment: {
        status: "failed",
        error: (result as { error: string }).error,
      },
    });
    expect(fittingSize("python", 25_000_000_000)).toBeNull();
  });

  it("warns about the start time a layer over 1 GB adds, without blocking", async () => {
    flags = { custom_sandbox_images: {} };
    stubPlan();
    const res = await deploy("large-layer");
    await layerBuilt(environment, {
      deployment: await ref(res.body.id),
      result: built(1_500_000_000, "c"),
    });
    const view = await read(res.body.id);
    expect(view.status).toBe("ready");
    expect(view.warnings).toContain(
      "the custom environment is 1.5 GB, which adds about 60 seconds to every sandbox start and wake",
    );
  });

  it("reports a failed build with its log", async () => {
    flags = { custom_sandbox_images: {} };
    stubPlan();
    const res = await deploy("broken");
    await layerBuilt(environment, {
      deployment: await ref(res.body.id),
      result: { error: "a setup step failed", log: "pip: no such package" },
    });
    expect(await read(res.body.id)).toMatchObject({
      status: "failed",
      sandboxEnvironment: { status: "failed", error: "a setup step failed" },
    });
  });
});

describe("layer keys", () => {
  it("are only ever under the organization's own prefix", () => {
    expect(ownsLayer("org_a", key("org_a"))).toBe(true);
    expect(ownsLayer("org_a", key("org_b"))).toBe(false);
    expect(
      ownsLayer("org_a", `org/org_a/layers/../../org_b/layers/${hash("a")}`),
    ).toBe(false);
    expect(ownsLayer("org_a", `org/org_ab/layers/${hash("a")}`)).toBe(false);
  });

  it("refuse a build result naming another organization's layer", async () => {
    flags = { custom_sandbox_images: {} };
    stubPlan();
    const other = await createOrganization(owner, "Otherco");
    const res = await deploy("foreign");
    const result = await layerBuilt(environment, {
      deployment: await ref(res.body.id),
      result: { ...built(10_000_000), key: key(other, "d") },
    });
    expect(result).toEqual({
      error: "the layer is not under this organization",
    });
    expect((await read(res.body.id)).status).toBe("failed");
  });

  it("never read another organization's deployment or store a key outside it", async () => {
    const otherOwner = (await signUp("Layer Outsider", environment)).client;
    const other = orgId(await createOrganization(otherOwner, "Elsewhere"));
    const [mine] = await withOrg(environment, org, (tx) =>
      tx
        .select()
        .from(deployments)
        .where(eq(deployments.status, "ready"))
        .limit(1),
    );
    expect(
      await deploymentLayer(environment, {
        organizationId: other,
        agentId: mine!.agentId,
        deploymentId: mine!.id,
      }),
    ).toBeNull();
    await expect(
      withOrg(environment, other, (tx) =>
        tx.insert(sandboxLayers).values({
          organizationId: other,
          key: key(org, "e"),
          image: "x",
          bytes: 1,
          unpackedBytes: 1,
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("layers as storage", () => {
  it("count each layer's bytes once toward the organization's storage", async () => {
    const bytes = async () =>
      (await withoutOrg(environment, "test: storage", storedBytes)).find(
        (r) => r.org === org,
      )!.bytes;
    const before = await bytes();
    await withOrg(environment, org, (tx) =>
      tx.insert(sandboxLayers).values({
        organizationId: org,
        key: key(org, "f"),
        image: "x",
        bytes: 123_000_000,
        unpackedBytes: 400_000_000,
      }),
    );
    expect((await bytes()) - before).toBe(123_000_000);
  });

  it("are collected once no live deployment names them", async () => {
    const day = 24 * 60 * 60 * 1000;
    const old = new Date(Date.now() - 2 * day);
    const agentId = newId("agent");
    await withOrg(environment, org, async (tx) => {
      await tx
        .insert(agents)
        .values({ id: agentId, organizationId: org, slug: "collected" });
      const row = (id: string, c: string, createdAt: Date) => ({
        id,
        organizationId: org,
        agentId,
        environment: "preview" as const,
        status: "ready" as const,
        bundleSha256: "00",
        sdkVersion: "0.1.0",
        manifest: {},
        source: "cli" as const,
        createdBy: "seed",
        gitBranch: "feature",
        createdAt,
        sandboxLayer: {
          status: "ready" as const,
          key: key(org, c),
          image: "x",
          bytes: 1,
        },
      });
      // The branch's older deployment is no longer live; its newest is.
      await tx
        .insert(deployments)
        .values([
          row(newId("deployment"), "1", new Date(Date.now() - 3 * day)),
          row(newId("deployment"), "2", old),
        ]);
      await tx.insert(sandboxLayers).values(
        ["1", "2", "3"].map((c) => ({
          organizationId: org,
          key: key(org, c),
          image: "x",
          bytes: 1,
          unpackedBytes: 1,
          createdAt: old,
        })),
      );
      await tx.insert(sandboxLayers).values({
        organizationId: org,
        key: key(org, "4"),
        image: "x",
        bytes: 1,
        unpackedBytes: 1,
      });
    });
    deleted.length = 0;
    await collectSandboxLayers(environment);
    expect(deleted).toContain(key(org, "1"));
    expect(deleted).toContain(key(org, "3"));
    expect(deleted).not.toContain(key(org, "2"));
    expect(deleted).not.toContain(key(org, "4"));
    const left = await withOrg(environment, org, (tx) =>
      tx.select({ key: sandboxLayers.key }).from(sandboxLayers),
    );
    expect(left.map((l) => l.key)).not.toContain(key(org, "1"));
    expect(left.map((l) => l.key)).toContain(key(org, "2"));
  });
});
