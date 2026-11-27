// The GitHub App end to end against a fake GitHub and a fake build sandbox:
// installing, linking a repository, and push builds that deploy through the
// same path as `preprocess deploy`, with the installation token scoped to
// the one repository, revoked after use, and kept out of the build.

import { env } from "cloudflare:workers";
import { readAuditEvents } from "@preprocess/db/audit";
import { orgId, withOrg, type OrgId } from "@preprocess/db/client";
import { deployments } from "@preprocess/db/schema/deployments";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  GITHUB_API,
  GITHUB_WEB,
  INSTALLATION,
  REPOSITORY,
} from "./fake-github.ts";
import { Client, createOrganization, signUp, testEnv } from "./helpers.ts";

type Build = {
  id: string;
  status: string;
  branch: string;
  commit: string;
  deploymentId: string | null;
  error: string | null;
  log?: string | null;
};
type Token = {
  value: string;
  repositoryIds?: number[];
  permissions: unknown;
  revoked: boolean;
  used: number;
};

const environment = testEnv();
let owner: Client;
let org: OrgId;

const call = async <T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
) => {
  const response = await owner.call<T>(path.replace("{org}", org), {
    method,
    ...(body !== undefined && { body }),
  });
  return { status: response.status, body: response.body };
};

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

const webhook = async (
  event: string,
  payload: unknown,
  secret = environment.GITHUB_WEBHOOK_SECRET!,
) => {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  const signature = [...mac]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const response = await new Client(environment, {
    "x-github-event": event,
    "x-hub-signature-256": `sha256=${signature}`,
  }).call<{ builds?: string[] }>("/v1/github/webhook", {
    method: "POST",
    body: payload,
  });
  return response;
};

const push = (branch: string, commit: string) =>
  webhook("push", {
    ref: `refs/heads/${branch}`,
    after: commit,
    repository: { id: REPOSITORY.id },
    installation: { id: INSTALLATION },
  });

const build = (id: string) =>
  eventually(
    async () =>
      (await call<Build>(`/v1/orgs/{org}/agents/stock/builds/${id}`)).body,
    (b) => !["queued", "running"].includes(b.status),
  );

const tokens = async () =>
  (await fetch(`${GITHUB_API}/__tokens`)).json<Token[]>();
const builder = async () =>
  (await (env.BUILDER as unknown as Fetcher).fetch("https://builder/")).json<{
    calls: Record<string, unknown>[];
    cancelled: string[];
  }>();

beforeAll(async () => {
  const signedUp = await signUp("Acme");
  owner = signedUp.client;
  org = orgId(await createOrganization(owner, "Acme"));
});

describe("installing the App", () => {
  it("links an installation only for a person GitHub says can reach it", async () => {
    const { body } = await call<{ url: string }>(
      "/v1/orgs/{org}/github/install",
      "POST",
    );
    const url = new URL(body.url);
    expect(url.pathname).toBe("/apps/preprocess-test/installations/new");
    const state = url.searchParams.get("state")!;
    const setup = (code: string, s = state) =>
      new Client(environment).call(
        `/v1/github/setup?installation_id=${INSTALLATION}&setup_action=install&state=${encodeURIComponent(s)}&code=${code}`,
      );
    expect((await setup("bad")).status).toBe(403);
    expect((await setup("good", `${state.split(".")[0]}.00`)).status).toBe(400);
    const linked = await setup("good");
    expect(linked.status).toBe(302);
    expect(linked.headers.get("location")).toBe(
      new URL("/settings/organization/github", environment.APP_URL).href,
    );

    const repos = await call<{ fullName: string; link: unknown }[]>(
      "/v1/orgs/{org}/github/repositories",
    );
    expect(repos.body.map((r) => r.fullName)).toEqual([
      "acme/agents",
      "acme/website",
    ]);
    // Listing used an installation-wide metadata token, revoked at once.
    expect((await tokens()).every((t) => t.revoked)).toBe(true);
  });

  it("refuses the same installation for another organization", async () => {
    const other = await signUp("Initrode");
    const otherOrg = await createOrganization(other.client, "Initrode");
    const { body } = await other.client.call<{ url: string }>(
      `/v1/orgs/${otherOrg}/github/install`,
      {
        method: "POST",
      },
    );
    const state = new URL(body.url).searchParams.get("state")!;
    const response = await new Client(environment).call(
      `/v1/github/setup?installation_id=${INSTALLATION}&state=${encodeURIComponent(state)}&code=good`,
    );
    expect(response.status).toBe(409);
    const theirs = await other.client.call<{ installations: unknown[] }>(
      `/v1/orgs/${otherOrg}/github/installations`,
    );
    expect(theirs.body).toEqual({ configured: true, installations: [] });
  });

  it("lists the organization's installations with their repository counts", async () => {
    const { body } = await call<{
      configured: boolean;
      installations: { id: string }[];
    }>("/v1/orgs/{org}/github/installations");
    expect(body.installations[0]?.id).toMatch(/\S/);
    expect(body).toMatchObject({
      configured: true,
      installations: [
        {
          account: "acme",
          accountType: "Organization",
          suspended: false,
          repositories: 2,
          manageUrl: `${GITHUB_WEB}/organizations/acme/settings/installations/${INSTALLATION}`,
        },
      ],
    });
  });

  it("returns a repository change made on GitHub to the GitHub page", async () => {
    const response = await new Client(environment).call(
      `/v1/github/setup?installation_id=${INSTALLATION}&setup_action=update`,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      new URL("/settings/organization/github", environment.APP_URL).href,
    );
  });
});

describe("push builds", () => {
  it("rejects a webhook with the wrong signature", async () => {
    expect((await webhook("push", {}, "not-the-secret")).status).toBe(401);
  });

  it("links a granted repository to an agent, and refuses others", async () => {
    expect(
      (
        await call("/v1/orgs/{org}/agents/stock/github", "PUT", {
          repository: "acme/elsewhere",
        })
      ).status,
    ).toBe(404);
    const linked = await call("/v1/orgs/{org}/agents/stock/github", "PUT", {
      repository: "acme/agents",
      directory: "agents/stock/",
    });
    expect(linked.body).toEqual({
      agent: "stock",
      repository: "acme/agents",
      branch: null,
      directory: "agents/stock",
      entry: "src/index.ts",
    });
  });

  it("builds a push in the sandbox and deploys it like preprocess deploy", async () => {
    const before = (await tokens()).length;
    const pushed = await push("main", "abc1234");
    expect(pushed.status).toBe(202);
    const done = await build(pushed.body.builds![0]!);
    expect(done).toMatchObject({
      status: "succeeded",
      branch: "main",
      commit: "abc1234",
    });
    expect(done.log).toContain("npm ci");

    const deployment = await call<{
      source: string;
      git: unknown;
      sdkVersion: string;
    }>(`/v1/orgs/{org}/agents/stock/deployments/${done.deploymentId}`);
    expect(deployment.body).toMatchObject({
      source: "github",
      git: { branch: "main", commit: "abc1234" },
      sdkVersion: "0.1.0",
    });
    const [stored] = await withOrg(env, org, (tx) =>
      tx
        .select({ manifest: deployments.manifest })
        .from(deployments)
        .where(eq(deployments.id, done.deploymentId!)),
    );
    expect(stored!.manifest).toMatchObject({
      entry: "agents/stock/src/index.ts",
    });

    // One token, for this repository's contents only, used for the tarball
    // and revoked; the sandbox got the tarball and nothing else.
    const issued = (await tokens()).slice(before);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({
      repositoryIds: [REPOSITORY.id],
      permissions: { contents: "read" },
      revoked: true,
      used: 1,
    });
    const { calls } = await builder();
    expect(calls.at(-1)).toEqual({
      id: done.id,
      directory: "agents/stock",
      entry: "src/index.ts",
      timeoutSeconds: 1,
      archive: "abc1234",
      owner: { organizationId: org, agent: "stock" },
    });
    const everything = JSON.stringify({ calls, build: done });
    for (const t of await tokens()) expect(everything).not.toContain(t.value);
  });

  it("records a failed build with its log, and deploys nothing", async () => {
    const pushed = await push("main", "fail0001");
    const done = await build(pushed.body.builds![0]!);
    expect(done).toMatchObject({ status: "failed", deploymentId: null });
    expect(done.log).toContain("Cannot find module");
  });

  it("stops at the wall-clock limit", async () => {
    const pushed = await push("feature-x", "late0001");
    const done = await build(pushed.body.builds![0]!);
    expect(done).toMatchObject({
      status: "timed_out",
      error: "the build ran longer than 1 seconds",
      deploymentId: null,
    });
  });

  it("lets the newest push to an agent's branch win", async () => {
    const first = await push("feature-y", "slow0001");
    await eventually(
      async () =>
        (
          await call<Build>(
            `/v1/orgs/{org}/agents/stock/builds/${first.body.builds![0]}`,
          )
        ).body,
      (b) => b.status === "running",
    );
    const second = await push("feature-y", "slow0002");
    const third = await push("feature-y", "abc0003");
    const [a, b, c] = await Promise.all([
      build(first.body.builds![0]!),
      build(second.body.builds![0]!),
      build(third.body.builds![0]!),
    ]);
    expect([a.status, b.status, c.status]).toEqual([
      "superseded",
      "superseded",
      "succeeded",
    ]);
    expect(a.deploymentId).toBeNull();
    expect(c.deploymentId).not.toBeNull();
    // The running build's sandbox was stopped.
    expect((await builder()).cancelled).toContain(a.id);
  });

  it("builds only the linked branch once a branch is set", async () => {
    await call("/v1/orgs/{org}/agents/stock/github", "PUT", {
      repository: "acme/agents",
      branch: "main",
    });
    expect((await push("feature-z", "abc0004")).body.builds).toEqual([]);
    expect((await push("main", "abc0005")).body.builds).toHaveLength(1);
  });

  it("forgets the installation when it is uninstalled", async () => {
    expect(
      (
        await webhook("installation", {
          action: "deleted",
          installation: { id: INSTALLATION },
        })
      ).status,
    ).toBe(200);
    expect((await call("/v1/orgs/{org}/github/repositories")).body).toEqual([]);
    const events = await withOrg(env, org, (tx) => readAuditEvents(tx, org));
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        "github.installed",
        "github.linked",
        "github.installation.deleted",
      ]),
    );
  });
});
