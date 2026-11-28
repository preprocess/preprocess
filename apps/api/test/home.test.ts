// The home page (PRE-178): roles and cards come from real state, first-time
// cards stay dismissed for that person in that organization only, previews
// respect agent access, and an API key has no home.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agentGrants, agents, groups } from "@preprocess/db/schema/access";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { homeDismissals } from "@preprocess/db/schema/home";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";

type Home = {
  roles: Record<
    "owner" | "admin" | "developer" | "operator" | "viewer",
    boolean
  >;
  cards: {
    id: string;
    card: string;
    kind: string;
    agent: { slug: string } | null;
  }[];
  agents: { total: number; items: { slug: string; status: string }[] } | null;
  cases: { items: { id: string; title: string | null }[] } | null;
  activity: { hours: unknown[] } | null;
  members: { count: number } | null;
};

const env = testEnv();
let org: string;
let owner: Client;
let developer: Client;
let operator: Client;
let viewer: Client;
let operatorId: string;
let otherOrg: string;

const home = async (who: Client, organization = org) => {
  const response = await who.call<Home>(`/v1/orgs/${organization}/home`);
  expect(response.status).toBe(200);
  return response.body;
};
const cardsOf = (body: Home) => body.cards.map((c) => c.card);

const seedAgent = async (
  slug: string,
  status: "ready" | "failed",
  by: string,
) =>
  withOrg(env, orgId(org), async (tx) => {
    const agent = newId("agent");
    const deployment = newId("deployment");
    await tx.insert(agents).values({ id: agent, organizationId: org, slug });
    await tx.insert(deployments).values({
      id: deployment,
      organizationId: org,
      agentId: agent,
      environment: "production",
      status,
      bundleSha256: "00",
      sdkVersion: "0.1.0",
      manifest: {},
      source: "github",
      createdBy: by,
    });
    await tx.insert(cases).values({
      id: newId("case"),
      organizationId: org,
      agentId: agent,
      deploymentId: deployment,
      status: "completed",
      source: "api",
      title: `${slug} case`,
    });
    return agent;
  });

beforeAll(async () => {
  const signedUp = await signUp("Hana Owner", env);
  owner = signedUp.client;
  org = await createOrganization(owner, "Homeco");
  const dev = await addMember(owner, org, "Dee Developer");
  developer = dev.client;
  const op = await addMember(owner, org, "Otto Operator");
  operator = op.client;
  operatorId = op.userId;
  const view = await addMember(owner, org, "Vic Viewer");
  viewer = view.client;

  const list = await owner.call<{ id: string; isDevelopers: boolean }[]>(
    `/v1/orgs/${org}/groups`,
  );
  const developers = list.body.find((g) => g.isDevelopers)!;
  await owner.call(
    `/v1/orgs/${org}/groups/${developers.id}/members/${dev.userId}`,
    {
      method: "PUT",
    },
  );

  const visible = await seedAgent("visible", "ready", signedUp.userId);
  await seedAgent("hidden", "failed", dev.userId);
  const [ops, views] = await withOrg(env, orgId(org), async (tx) => {
    const ids = [newId("group"), newId("group")] as const;
    await tx.insert(groups).values([
      { id: ids[0], organizationId: org, slug: "ops", name: "Ops" },
      { id: ids[1], organizationId: org, slug: "views", name: "Views" },
    ]);
    await tx.insert(agentGrants).values([
      {
        organizationId: org,
        agentId: visible,
        groupId: ids[0],
        access: "operator",
        grantedBy: "test",
      },
      {
        organizationId: org,
        agentId: visible,
        groupId: ids[1],
        access: "viewer",
        grantedBy: "test",
      },
    ]);
    return ids;
  });
  await owner.call(`/v1/orgs/${org}/groups/${ops}/members/${op.userId}`, {
    method: "PUT",
  });
  await owner.call(`/v1/orgs/${org}/groups/${views}/members/${view.userId}`, {
    method: "PUT",
  });

  otherOrg = await createOrganization(operator, "Elsewhere");
});

describe("home", () => {
  it("names each person's roles", async () => {
    expect((await home(owner)).roles).toMatchObject({
      owner: true,
      developer: false,
    });
    expect((await home(developer)).roles).toMatchObject({
      owner: false,
      developer: true,
    });
    expect((await home(operator)).roles).toMatchObject({
      operator: true,
      developer: false,
    });
    expect((await home(viewer)).roles).toMatchObject({
      viewer: true,
      operator: false,
      developer: false,
    });
  });

  it("shows broken cards before first-time ones, from real state", async () => {
    const dev = await home(developer);
    expect(dev.cards[0]).toMatchObject({
      card: "fix-failed-deploy",
      kind: "broken",
      agent: { slug: "hidden" },
    });
    expect(cardsOf(dev)).toEqual(
      expect.arrayContaining(["install-cli", "run-test-case", "connect-mcp"]),
    );
    expect(cardsOf(dev)).not.toContain("deploy-template");

    const own = await home(owner);
    // Agents, people and groups exist, and the free plan has no SSO.
    expect(cardsOf(own)).toEqual([]);
    expect(own.members?.count).toBe(4);
    expect(own.agents?.total).toBe(2);
  });

  it("keeps previews to the agents a person can see", async () => {
    for (const who of [operator, viewer]) {
      const body = await home(who);
      expect(body.cases?.items.map((c) => c.title)).toEqual(["visible case"]);
      expect(body.agents).toBeNull();
      expect(body.activity).toBeNull();
      expect(body.members).toBeNull();
    }
    expect(cardsOf(await home(viewer))).toEqual([]);
    expect((await home(developer)).cases?.items).toHaveLength(2);
  });

  it("keeps a dismissed first-time card dismissed for that person in that organization", async () => {
    expect(cardsOf(await home(operator))).toContain("open-first-case");
    const dismissed = await operator.call(
      `/v1/orgs/${org}/home/dismissed/open-first-case`,
      { method: "PUT" },
    );
    expect(dismissed.status).toBe(204);
    expect(
      (
        await operator.call(`/v1/orgs/${org}/home/dismissed/open-first-case`, {
          method: "PUT",
        })
      ).status,
    ).toBe(204);
    expect(cardsOf(await home(operator))).not.toContain("open-first-case");

    // Another organization the same person owns is new to them there.
    expect(cardsOf(await home(operator, otherOrg))).toEqual([
      "deploy-first-agent",
      "invite-team",
      "create-group",
    ]);
    const rows = await withOrg(env, orgId(otherOrg), (tx) =>
      tx
        .select({ card: homeDismissals.card })
        .from(homeDismissals)
        .where(eq(homeDismissals.userId, operatorId)),
    );
    expect(rows).toEqual([]);
  });

  it("refuses broken cards as dismissals and outsiders", async () => {
    expect(
      (
        await developer.call(
          `/v1/orgs/${org}/home/dismissed/fix-failed-deploy`,
          { method: "PUT" },
        )
      ).status,
    ).toBe(400);
    expect((await developer.call(`/v1/orgs/${otherOrg}/home`)).status).toBe(
      403,
    );
  });

  it("has no home for an API key", async () => {
    const created = await owner.call<{ key: string }>(
      "/api/auth/api-key/create",
      {
        body: { name: "home", organizationId: org },
      },
    );
    const key = new Client(env, {
      authorization: `Bearer ${created.body.key}`,
    });
    expect((await key.call(`/v1/orgs/${org}/home`)).status).toBe(403);
  });
});
