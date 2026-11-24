// The network guardrail and loosening requests (spec 5): organization rules,
// per-agent rules that only narrow them, and requests an Owner or Admin
// approves or rejects, each audited with its old and new values.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents, groupMembers, groups } from "@preprocess/db/schema/access";
import { secretGrants } from "@preprocess/db/schema/deployments";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { Env } from "../src/env.ts";
import { loosens, narrow, NO_HOST, opening, permits } from "../src/network.ts";
import type { Client } from "./helpers.ts";
import { addMember, createOrganization, signUp, testEnv } from "./helpers.ts";

const environment: Env = testEnv();

type Rules = { allow: string[]; block: string[] };
type Request = { id: string; status: string; agent: string | null };

let owner: Client;
let developer: Client;
let member: Client;
let org: string;
const agentId = newId("agent");

beforeAll(async () => {
  owner = (await signUp("Guard", environment)).client;
  org = await createOrganization(owner, "Guardco");
  const dev = await addMember(owner, org, "Dev");
  developer = dev.client;
  member = (await addMember(owner, org, "Plain")).client;
  await withOrg(environment, orgId(org), async (tx) => {
    await tx
      .insert(agents)
      .values({ id: agentId, organizationId: org, slug: "invoices" });
    const [developers] = await tx
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.isDevelopers, true));
    await tx.insert(groupMembers).values({
      organizationId: org,
      groupId: developers!.id,
      userId: dev.userId,
    });
  });
});

describe("network rules", () => {
  it("narrow: an agent only ever narrows the organization", () => {
    const org = { allow: ["*.example.com"], block: ["bad.example.com"] };
    expect(narrow(org, { allow: ["erp.example.com"], block: [] })).toEqual({
      allow: ["erp.example.com"],
      block: ["bad.example.com"],
    });
    expect(narrow(org, { allow: ["*.other.com"], block: [] }).allow).toEqual([
      NO_HOST,
    ]);
    expect(
      narrow({ allow: [], block: [] }, { allow: ["a.com"], block: [] }),
    ).toEqual({ allow: ["a.com"], block: [] });
  });

  it("detects loosening and opens only the asked hosts", () => {
    const closed = { allow: ["a.com"], block: ["b.com"] };
    expect(loosens(closed, { allow: ["a.com"], block: [] })).toBe(true);
    expect(loosens(closed, { allow: [], block: ["b.com"] })).toBe(true);
    expect(
      loosens(closed, { allow: ["a.com", "c.com"], block: ["b.com"] }),
    ).toBe(true);
    expect(
      loosens(closed, { allow: ["a.com"], block: ["b.com", "d.com"] }),
    ).toBe(false);
    const opened = opening(closed, ["b.com", "c.com"]);
    expect(opened).toEqual({ allow: ["a.com", "b.com", "c.com"], block: [] });
    expect(permits(opened, "c.com")).toBe(true);
    expect(permits(closed, "c.com")).toBe(false);
    expect(permits({ allow: [], block: ["*.x.com"] }, "api.x.com")).toBe(false);
  });

  it("default to allow-all and change only by Owners and Admins", async () => {
    const start = await owner.call<{ network: Rules; modelEndpoints: string }>(
      `/v1/orgs/${org}/guardrails`,
    );
    expect(start.body).toEqual({
      network: { allow: [], block: [] },
      modelEndpoints: "hosted",
    });
    const rules = { allow: ["*.example.com"], block: ["Bank.example.com"] };
    expect(
      (
        await developer.call(`/v1/orgs/${org}/guardrails/network`, {
          method: "PUT",
          body: rules,
        })
      ).status,
    ).toBe(403);
    const set = await owner.call<Rules>(`/v1/orgs/${org}/guardrails/network`, {
      method: "PUT",
      body: rules,
    });
    expect(set.status).toBe(200);
    expect(set.body.block).toEqual(["bank.example.com"]);
    expect(
      (
        await owner.call(`/v1/orgs/${org}/guardrails/network`, {
          method: "PUT",
          body: { allow: ["not a host"], block: [] },
        })
      ).status,
    ).toBe(400);
  });

  it("apply an agent's rules on top of the organization's", async () => {
    const set = await owner.call<{ effective: Rules; agent: Rules }>(
      `/v1/orgs/${org}/agents/invoices/network`,
      { method: "PUT", body: { allow: ["erp.example.com"], block: [] } },
    );
    expect(set.status).toBe(200);
    expect(set.body.effective).toEqual({
      allow: ["erp.example.com"],
      block: ["bank.example.com"],
    });
  });
});

describe("guardrail requests", () => {
  const file = (client: Client, body: unknown) =>
    client.call<Request & { error?: { code: string } }>(
      `/v1/orgs/${org}/guardrail-requests`,
      { body },
    );

  it("are filed by Developers, not by plain members", async () => {
    const change = { kind: "network", hosts: ["bank.example.com"] };
    expect((await file(member, { agent: "invoices", change })).status).toBe(
      403,
    );
    expect(
      (await file(developer, { change: { kind: "secret", secret: "X" } }))
        .status,
    ).toBe(400);
    const filed = await file(developer, {
      agent: "invoices",
      change,
      reason: "Bank feed",
    });
    expect(filed.status).toBe(201);
    expect(filed.body).toMatchObject({ status: "pending", agent: "invoices" });
  });

  it("are decided only by Owners and Admins, once", async () => {
    const [pending] = (
      await owner.call<Request[]>(
        `/v1/orgs/${org}/guardrail-requests?status=pending`,
      )
    ).body;
    const approve = (client: Client) =>
      client.call<Request>(
        `/v1/orgs/${org}/guardrail-requests/${pending!.id}/approve`,
        { method: "POST" },
      );
    expect((await approve(developer)).status).toBe(403);
    const approved = await approve(owner);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
    expect((await approve(owner)).status).toBe(409);

    const rules = await owner.call<{ organization: Rules; effective: Rules }>(
      `/v1/orgs/${org}/agents/invoices/network`,
    );
    expect(rules.body.organization.block).toEqual([]);
    expect(rules.body.effective.allow).toEqual([
      "bank.example.com",
      "erp.example.com",
    ]);

    const audit = await owner.call<{
      events: { action: string; data: { loosened?: boolean } }[];
    }>(`/v1/orgs/${org}/audit-events?action=guardrail.updated`);
    expect(audit.body.events.at(-1)?.data).toMatchObject({ loosened: true });
  });

  it("grant a secret on approval and change nothing on rejection", async () => {
    const created = await owner.call(`/v1/orgs/${org}/secrets/ERP_TOKEN`, {
      method: "PUT",
      body: { value: "s3cret" },
    });
    expect(created.status).toBeLessThan(300);
    const rejected = await file(developer, {
      agent: "invoices",
      change: { kind: "secret", secret: "ERP_TOKEN" },
    });
    const decided = await owner.call<Request>(
      `/v1/orgs/${org}/guardrail-requests/${rejected.body.id}/reject`,
      { method: "POST" },
    );
    expect(decided.body.status).toBe("rejected");
    const grants = () =>
      withOrg(environment, orgId(org), (tx) =>
        tx.select().from(secretGrants).where(eq(secretGrants.agentId, agentId)),
      );
    expect(await grants()).toHaveLength(0);

    const asked = await file(developer, {
      agent: "invoices",
      change: { kind: "secret", secret: "ERP_TOKEN" },
    });
    await owner.call(
      `/v1/orgs/${org}/guardrail-requests/${asked.body.id}/approve`,
      { method: "POST" },
    );
    expect(await grants()).toHaveLength(1);
  });
});
