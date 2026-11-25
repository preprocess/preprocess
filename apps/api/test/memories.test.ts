// Supervised memory (spec 10): the agent proposes through the Platform
// entrypoint; only a person with operator access accepts or dismisses; any
// operator, Developer, Admin or API key deletes an accepted rule; accepted
// rules reach new cases and eval runs; proposals reach the inbox of people
// who work the agent; and another organization sees none of it.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import {
  agentGrants,
  agents,
  groupMembers,
  groups,
} from "@preprocess/db/schema/access";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { MEMORY_CAP, agentMemories } from "@preprocess/db/schema/memories";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { acceptedMemories, proposeMemory } from "../src/memories.ts";
import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";

const environment = testEnv();

type Memory = { id: string; status: string; text: string; caseId: string };

let owner: Client;
let org: string;
let operator: { client: Client; userId: string };
let viewer: { client: Client; userId: string };
let keyed: Client;
let other: Client;
let otherOrg: string;
const agentId = newId("agent");
const deploymentId = newId("deployment");

const newCase = async () => {
  const id = newId("case");
  await withOrg(environment, orgId(org), (tx) =>
    tx.insert(cases).values({
      id,
      organizationId: org,
      agentId,
      deploymentId,
      status: "completed",
      source: "api",
      title: "Renewal pack",
    }),
  );
  return id;
};

const propose = (caseId: string, text: string) =>
  proposeMemory(environment, {
    organizationId: org,
    agentId,
    caseId,
    text,
    reason: "Seen on this case",
  });

const proposed = async (text: string) => {
  const caseId = await newCase();
  const result = await propose(caseId, text);
  if (result.result === "refused") throw new Error(result.reason);
  return { caseId, id: result.id };
};

const decide = (
  client: Client,
  m: { caseId: string; id: string },
  action: "accept" | "dismiss",
) =>
  client.call<Memory>(
    `/v1/orgs/${org}/cases/${m.caseId}/memories/${m.id}/${action}`,
    { body: {} },
  );

beforeAll(async () => {
  const ana = await signUp("Ana", environment);
  owner = ana.client;
  org = await createOrganization(owner, "Acme");
  operator = await addMember(owner, org, "Lee");
  viewer = await addMember(owner, org, "Vic");
  const key = await owner.call<{ key: string }>("/api/auth/api-key/create", {
    body: { name: "ci", organizationId: org },
  });
  keyed = new Client(environment, { "x-api-key": key.body.key });
  const ops = newId("group");
  const watchers = newId("group");
  await withOrg(environment, orgId(org), async (tx) => {
    await tx
      .insert(agents)
      .values({ id: agentId, organizationId: org, slug: "intake" });
    await tx.insert(deployments).values({
      id: deploymentId,
      organizationId: org,
      agentId,
      environment: "production",
      status: "ready",
      bundleSha256: "00",
      sdkVersion: "0.1.0",
      manifest: {},
      source: "cli",
      createdBy: ana.userId,
      promotedAt: new Date(),
    });
    await tx.insert(groups).values([
      { id: ops, organizationId: org, slug: "ops", name: "Ops" },
      { id: watchers, organizationId: org, slug: "watchers", name: "Watchers" },
    ]);
    await tx.insert(groupMembers).values([
      { organizationId: org, groupId: ops, userId: operator.userId },
      { organizationId: org, groupId: watchers, userId: viewer.userId },
    ]);
    await tx.insert(agentGrants).values([
      {
        organizationId: org,
        agentId,
        groupId: ops,
        access: "operator",
        grantedBy: ana.userId,
      },
      {
        organizationId: org,
        agentId,
        groupId: watchers,
        access: "viewer",
        grantedBy: ana.userId,
      },
    ]);
  });
  other = (await signUp("Otto", environment)).client;
  otherOrg = await createOrganization(other, "Globex");
});

describe("memory", () => {
  it("records a proposal once per case and refuses an empty or long rule", async () => {
    const caseId = await newCase();
    const first = await propose(
      caseId,
      "Order forms put the term on page one.",
    );
    const again = await propose(
      caseId,
      "Order forms put the term on page one.",
    );
    expect(first.result).toBe("proposed");
    expect(again).toEqual({
      result: "duplicate",
      id: (first as { id: string }).id,
    });
    expect((await propose(caseId, "  ")).result).toBe("refused");
    expect((await propose(caseId, "x".repeat(501))).result).toBe("refused");
    const unknown = await proposeMemory(environment, {
      organizationId: org,
      agentId,
      caseId: newId("case"),
      text: "No such case",
      reason: null,
    });
    expect(unknown.result).toBe("refused");
  });

  it("lets only a person with operator access decide", async () => {
    const m = await proposed("Skip cover emails when counting pages.");
    expect((await decide(viewer.client, m, "accept")).status).toBe(403);
    expect((await decide(keyed, m, "accept")).status).toBe(403);
    const accepted = await decide(operator.client, m, "accept");
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("accepted");
    expect((await decide(operator.client, m, "dismiss")).status).toBe(409);

    const dismissed = await proposed("Ignore the fax header.");
    expect(
      (await decide(operator.client, dismissed, "dismiss")).body.status,
    ).toBe("dismissed");

    const list = await viewer.client.call<{ memories: Memory[] }>(
      `/v1/orgs/${org}/agents/intake/memories`,
    );
    expect(list.body.memories.map((r) => r.text)).toContain(
      "Skip cover emails when counting pages.",
    );
    expect(list.body.memories.map((r) => r.text)).not.toContain(
      "Ignore the fax header.",
    );
    const onCase = await keyed.call<{ memories: Memory[] }>(
      `/v1/orgs/${org}/cases/${m.caseId}/memories`,
    );
    expect(onCase.body.memories).toMatchObject([
      { id: m.id, status: "accepted" },
    ]);
  });

  it("hands new cases and reruns the accepted rules only", async () => {
    await withOrg(environment, orgId(org), async (tx) => {
      const rules = await acceptedMemories(tx, agentId);
      expect(rules.map((r) => r.text)).toContain(
        "Skip cover emails when counting pages.",
      );
    });
  });

  it("puts proposals in the inbox of people who work the agent", async () => {
    const m = await proposed("Initech writes currency after the amount.");
    const items = async (client: Client) =>
      (
        await client.call<{ items: { key: string; message: string | null }[] }>(
          `/v1/orgs/${org}/inbox`,
        )
      ).body.items.filter((i) => i.key === `memory:${m.id}`);
    expect(await items(operator.client)).toMatchObject([
      { message: "Initech writes currency after the amount." },
    ]);
    expect(await items(viewer.client)).toEqual([]);
    await decide(operator.client, m, "dismiss");
    expect(await items(operator.client)).toEqual([]);
  });

  it("lets operators and API keys delete an accepted rule, not viewers", async () => {
    const m = await proposed("Flag notice periods under 30 days.");
    await decide(operator.client, m, "accept");
    const path = `/v1/orgs/${org}/agents/intake/memories/${m.id}`;
    expect((await viewer.client.call(path, { method: "DELETE" })).status).toBe(
      403,
    );
    expect(
      (await operator.client.call(path, { method: "DELETE" })).status,
    ).toBe(204);
    expect((await keyed.call(path, { method: "DELETE" })).status).toBe(404);
    const second = await proposed("Quote the clause number.");
    await decide(operator.client, second, "accept");
    expect(
      (
        await keyed.call(
          `/v1/orgs/${org}/agents/intake/memories/${second.id}`,
          { method: "DELETE" },
        )
      ).status,
    ).toBe(204);
  });

  it("refuses proposals once the agent holds the cap", async () => {
    await withOrg(environment, orgId(org), async (tx) => {
      const held = await tx
        .select({ id: agentMemories.id })
        .from(agentMemories)
        .where(eq(agentMemories.agentId, agentId));
      const caseId = await newCase();
      await tx.insert(agentMemories).values(
        Array.from({ length: MEMORY_CAP }, (_, i) => ({
          id: newId("memory"),
          organizationId: org,
          agentId,
          caseId,
          text: `Filler rule ${i}`,
          status: "accepted" as const,
        })),
      );
      expect(held.length).toBeGreaterThan(0);
    });
    const caseId = await newCase();
    const refused = await propose(caseId, "One rule too many.");
    expect(refused.result).toBe("refused");
  });

  it("hides one organization's memories from another", async () => {
    const list = await other.call(`/v1/orgs/${org}/agents/intake/memories`);
    expect(list.status).toBe(403);
    const own = await other.call(`/v1/orgs/${otherOrg}/agents/intake/memories`);
    expect(own.status).toBe(404);
  });
});
