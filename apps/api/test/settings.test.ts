// Agent settings and their sources (spec 5): a dashboard override wins, then
// the code, then the organization's default, then the platform's. Promoting a
// deployment clears the overrides and says so.

import { orgId, withOrg, type OrgId } from "@preprocess/db/client";
import { agents } from "@preprocess/db/schema/access";
import { deployments } from "@preprocess/db/schema/deployments";
import { organizationDefaults } from "@preprocess/db/schema/settings";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { Manifest } from "../src/deploy.ts";
import { effectiveSettings } from "../src/settings.ts";
import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import networkAgent from "./dist/network-agent.js?raw";

type Setting = { key: string; value: unknown; source: string };
type Settings = { deployment: string; settings: Setting[]; warnings: string[] };
type Deployment = { id: string; status: string; warnings: string[] };

let org: OrgId;
let key: Client;
let member: Client;

const settings = async () =>
  (await key.call<Settings>(`/v1/orgs/${org}/agents/network-agent/settings`))
    .body;
const setting = async (name: string) =>
  (await settings()).settings.find((s) => s.key === name);

const deploy = () =>
  key.call<Deployment>(`/v1/orgs/${org}/agents/network-agent/deployments`, {
    body: {
      bundle: { mainModule: "agent.js", modules: { "agent.js": networkAgent } },
      git: { branch: "main" },
    },
  });

beforeAll(async () => {
  const { client } = await signUp("Settler");
  org = orgId(await createOrganization(client, "Settleco"));
  member = (await addMember(client, org, "Viewer")).client;
  const created = await client.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "deploy", organizationId: org } },
  );
  key = new Client(testEnv(), {
    authorization: `Bearer ${created.body.key}`,
  });
  expect((await deploy()).body.status).toBe("ready");
});

describe("agent settings", () => {
  it("come from the platform until code or the organization sets them", async () => {
    expect(await setting("model")).toMatchObject({
      value: "deepseek-v4.1-flash",
      source: "default",
    });
    const patched = await key.call(`/v1/orgs/${org}/defaults`, {
      method: "PATCH",
      body: { model: "kimi-k3.1-pro", ocr: true },
    });
    expect(patched.body).toEqual({ model: "kimi-k3.1-pro", ocr: true });
    expect(
      (
        await member.call(`/v1/orgs/${org}/defaults`, {
          method: "PATCH",
          body: { ocr: false },
        })
      ).status,
    ).toBe(403);
    expect(await setting("model")).toMatchObject({
      value: "kimi-k3.1-pro",
      source: "organization",
    });
    expect(
      (
        await key.call(`/v1/orgs/${org}/defaults`, {
          method: "PATCH",
          body: { ocr: null },
        })
      ).body,
    ).toEqual({ model: "kimi-k3.1-pro" });
  });

  it("take a dashboard override from Developers, checked by key", async () => {
    const put = (client: Client, name: string, value: unknown) =>
      client.call<Settings>(
        `/v1/orgs/${org}/agents/network-agent/settings/${name}`,
        { method: "PUT", body: { value } },
      );
    expect((await put(member, "reasoning", "high")).status).toBe(403);
    expect((await put(key, "reasoning", "extreme")).status).toBe(400);
    expect((await put(key, "colour", "red")).status).toBe(404);
    const set = await put(key, "reasoning", "high");
    expect(set.status).toBe(200);
    expect(set.body.settings.find((s) => s.key === "reasoning")).toMatchObject({
      value: "high",
      source: "override",
    });
    expect(set.body.warnings).toEqual([
      'promoting this deployment clears the dashboard override of reasoning ("high")',
    ]);

    const [agent] = await withOrg(testEnv(), org, (tx) =>
      tx.select().from(agents).where(eq(agents.slug, "network-agent")),
    );
    const applied = await withOrg(testEnv(), org, async (tx) => {
      const [d] = await tx
        .select()
        .from(deployments)
        .where(eq(deployments.id, set.body.deployment));
      return effectiveSettings(tx, agent!.id, d!.manifest as Manifest);
    });
    expect(applied).toMatchObject({
      model: "kimi-k3.1-pro",
      reasoning: "high",
      ocr: false,
    });
  });

  it("lose their overrides when a deployment is promoted", async () => {
    const promoted = await deploy();
    expect(promoted.body.warnings).toEqual([
      'promotion cleared the dashboard override of reasoning ("high")',
    ]);
    expect(await setting("reasoning")).toMatchObject({
      value: "medium",
      source: "default",
    });
    const audit = await key.call<{ events: { data: unknown }[] }>(
      `/v1/orgs/${org}/audit-events?action=settings.overrides.cleared`,
    );
    expect(audit.body.events.map((e) => e.data)).toEqual([
      { deployment: promoted.body.id, cleared: { reasoning: "high" } },
    ]);
  });

  it("read a model spec 1.5 retired as the model that replaced it", async () => {
    await withOrg(testEnv(), org, (tx) =>
      tx
        .update(organizationDefaults)
        .set({ values: { model: "inkling-2-small" } }),
    );
    expect(await setting("model")).toMatchObject({
      value: "deepseek-v4.1-flash",
      source: "organization",
    });
  });
});
