// The spending-limit guardrail (spec 5, design doc 04): none by default, set
// only by an Owner or Admin, counted per calendar month in UTC, and enforced
// with 402 spending_limit_reached at case creation, rerun and OCR.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { beforeAll, describe, expect, it } from "vitest";

import type { Env, Runtime } from "../src/env.ts";
import { Platform } from "../src/platform.ts";
import { monthStart } from "../src/spend.ts";
import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";

const reruns: unknown[] = [];
const runtime = {
  rerun: (input: unknown) => {
    reruns.push(input);
    return Promise.resolve({
      status: "running",
      run: 2,
      answers: null,
      checks: [],
    });
  },
} as unknown as Runtime;

const environment: Env = testEnv({
  RUNTIME: runtime,
  CASES: { send: () => Promise.resolve() } as unknown as Queue,
});

let owner: Client;
let ownerId: string;
let member: Client;
let keyed: Client;
let org: string;
const agentId = newId("agent");
const deploymentId = newId("deployment");
const pastCase = newId("case");

type Spending = {
  month: string;
  spentUsd: number;
  limitUsd: number | null;
  reached: boolean;
};

const setLimit = (client: Client, limitUsd: number | null) =>
  client.call<Spending>(`/v1/orgs/${org}/spending/limit`, {
    method: "PUT",
    body: { limitUsd },
  });

const startCase = () =>
  keyed.call<{ id: string; error?: { code: string } }>(
    `/v1/orgs/${org}/cases`,
    { body: { agent: "invoices", text: "Invoice 7" } },
  );

beforeAll(async () => {
  const ana = await signUp("Spender", environment);
  owner = ana.client;
  ownerId = ana.userId;
  org = await createOrganization(owner, "Spendco");
  member = (await addMember(owner, org, "Max")).client;
  // An organization API key acts as Admin and may start any agent's cases.
  const key = await owner.call<{ key: string }>("/api/auth/api-key/create", {
    body: { name: "ci", organizationId: org },
  });
  keyed = new Client(environment, { "x-api-key": key.body.key });
  await withOrg(environment, orgId(org), async (tx) => {
    await tx
      .insert(agents)
      .values({ id: agentId, organizationId: org, slug: "invoices" });
    await tx.insert(deployments).values({
      id: deploymentId,
      organizationId: org,
      agentId,
      environment: "production",
      status: "ready",
      scriptName: `${org}--invoices--${deploymentId}`,
      bundleSha256: "00",
      sdkVersion: "0.1.0",
      manifest: {},
      source: "cli",
      createdBy: ownerId,
      promotedAt: new Date(),
    });
    const now = new Date();
    const lastMonth = new Date(monthStart(now).getTime() - 1);
    // $3 this month, and $50 last month that must not count.
    await tx.insert(cases).values([
      {
        id: pastCase,
        organizationId: org,
        agentId,
        deploymentId,
        source: "api",
        createdBy: ownerId,
        status: "completed",
        costMicroUsd: 3_000_000,
      },
      {
        id: newId("case"),
        organizationId: org,
        agentId,
        deploymentId,
        source: "api",
        createdBy: ownerId,
        status: "completed",
        costMicroUsd: 50_000_000,
        createdAt: lastMonth,
        updatedAt: lastMonth,
      },
    ]);
  });
});

describe("spending limit", () => {
  it("is off by default and counts only this UTC month", async () => {
    const spending = await owner.call<Spending>(`/v1/orgs/${org}/spending`);
    expect(spending.status).toBe(200);
    expect(spending.body).toMatchObject({
      spentUsd: 3,
      limitUsd: null,
      reached: false,
    });
    expect(spending.body.month).toBe(new Date().toISOString().slice(0, 7));
    expect((await startCase()).status).toBe(202);
  });

  it("is set only by Owners and Admins", async () => {
    expect((await setLimit(member, 1)).status).toBe(403);
  });

  it("refuses new cases, reruns and OCR with 402 once reached", async () => {
    const set = await setLimit(owner, 2.5);
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ limitUsd: 2.5, reached: true });

    const refused = await startCase();
    expect(refused.status).toBe(402);
    expect(refused.body.error?.code).toBe("spending_limit_reached");

    const rerun = await keyed.call<{ error: { code: string } }>(
      `/v1/orgs/${org}/cases/${pastCase}/rerun`,
      { method: "POST" },
    );
    expect(rerun.status).toBe(402);
    expect(rerun.body.error.code).toBe("spending_limit_reached");
    expect(reruns).toHaveLength(0);

    const ocr = await keyed.call<{ error: { code: string } }>(
      `/v1/orgs/${org}/ocr`,
      { body: { file: "file_missing" } },
    );
    expect(ocr.status).toBe(402);

    const gate = new Platform({} as ExecutionContext, environment);
    expect(await gate.spendGate(org)).toBe("spending_limit_reached");
  });

  it("lets work resume when raised, and audits each change with old and new values", async () => {
    expect((await setLimit(owner, 10)).body.reached).toBe(false);
    expect((await startCase()).status).toBe(202);
    const gate = new Platform({} as ExecutionContext, environment);
    expect(await gate.spendGate(org)).toBe("ok");
    expect((await setLimit(owner, null)).body.limitUsd).toBeNull();

    const audit = await owner.call<{
      events: { action: string; actorId: string; data: unknown }[];
    }>(`/v1/orgs/${org}/audit-events?action=guardrail.updated`);
    expect(audit.body.events.map((e) => e.data)).toEqual([
      {
        guardrail: "spending_limit",
        loosened: false,
        before: null,
        after: 2.5,
      },
      { guardrail: "spending_limit", loosened: true, before: 2.5, after: 10 },
      { guardrail: "spending_limit", loosened: true, before: 10, after: null },
    ]);
    expect(audit.body.events.every((e) => e.actorId === ownerId)).toBe(true);
  });

  it("is invisible to other organizations", async () => {
    const other = await createOrganization(
      (await signUp("Elsewhere", environment)).client,
      "Elsewhere",
    );
    expect((await owner.call(`/v1/orgs/${other}/spending`)).status).toBe(403);
  });
});
