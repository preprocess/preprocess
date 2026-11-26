// Metering (spec 16a): cases counted once at creation and never on rerun,
// each case's charges recorded once as they grow, active seats marked by the
// work people do, and nothing recorded on a self-hosted install.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import {
  agentGrants,
  agents,
  groupMembers,
  groups,
} from "@preprocess/db/schema/access";
import { seatActivity, usageRecords } from "@preprocess/db/schema/billing";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { CaseEvent } from "../src/cases.ts";
import { deploySeatHolder } from "../src/deploy.ts";
import type { Env, Runtime } from "../src/env.ts";
import { meter, monthOf } from "../src/metering.ts";
import { Platform } from "../src/platform.ts";
import { Client, createOrganization, signUp, testEnv } from "./helpers.ts";

const runtime = {
  rerun: () =>
    Promise.resolve({ status: "running", run: 2, answers: null, checks: [] }),
} as unknown as Runtime;

const environment: Env = testEnv({
  RUNTIME: runtime,
  CASES: { send: () => Promise.resolve() } as unknown as Queue,
});

let owner: Client;
let ownerId: string;
let keyed: Client;
let keyId: string;
let org: string;
const agentId = newId("agent");
const deploymentId = newId("deployment");

const usage = () =>
  withOrg(environment, orgId(org), (tx) =>
    tx
      .select({
        feature: usageRecords.feature,
        quantity: usageRecords.quantity,
        caseId: usageRecords.caseId,
      })
      .from(usageRecords),
  );

const status = (
  caseId: string,
  extra: Partial<Extract<CaseEvent, { type: "status" }>>,
) =>
  new Platform({} as ExecutionContext, environment).caseEvent({
    type: "status",
    organizationId: org,
    agentId,
    caseId,
    status: "running",
    waitingOn: null,
    reason: null,
    answers: null,
    error: null,
    ...extra,
  });

beforeAll(async () => {
  const ana = await signUp("Meter", environment);
  owner = ana.client;
  ownerId = ana.userId;
  org = await createOrganization(owner, "Meterco");
  const key = await owner.call<{ key: string; id: string }>(
    "/api/auth/api-key/create",
    { body: { name: "ci", organizationId: org } },
  );
  keyed = new Client(environment, { "x-api-key": key.body.key });
  keyId = key.body.id;
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
      bundleSha256: "00",
      sdkVersion: "0.1.0",
      manifest: {},
      source: "cli",
      createdBy: ownerId,
      promotedAt: new Date(),
    });
    const groupId = newId("group");
    await tx
      .insert(groups)
      .values({ id: groupId, organizationId: org, slug: "ap", name: "AP" });
    await tx
      .insert(groupMembers)
      .values({ organizationId: org, groupId, userId: ownerId });
    await tx.insert(agentGrants).values({
      organizationId: org,
      agentId,
      groupId,
      access: "operator",
      grantedBy: ownerId,
    });
  });
});

describe("metering", () => {
  let caseId: string;

  it("counts a case once when it is created", async () => {
    const created = await keyed.call<{ id: string }>(`/v1/orgs/${org}/cases`, {
      body: { agent: "invoices", text: "Invoice 7" },
    });
    expect(created.status).toBe(202);
    caseId = created.body.id;
    expect(await usage()).toEqual([{ feature: "cases", quantity: 1, caseId }]);
  });

  it("records each kind of charge once, as the case's totals grow", async () => {
    await withOrg(environment, orgId(org), (tx) =>
      tx.update(cases).set({ status: "running" }).where(eq(cases.id, caseId)),
    );
    await status(caseId, {
      costMicroUsd: 1_500,
      charges: { model: 1_000, decide: 500, ocr: 0 },
    });
    await status(caseId, {
      costMicroUsd: 1_500,
      charges: { model: 1_000, decide: 500, ocr: 0 },
    });
    await status(caseId, {
      status: "completed",
      costMicroUsd: 4_700,
      charges: { model: 3_000, decide: 500, ocr: 1_200 },
      captureBytes: 2_048,
    });
    const totals = new Map<string, number>();
    for (const r of await usage())
      totals.set(r.feature, (totals.get(r.feature) ?? 0) + r.quantity);
    expect(Object.fromEntries(totals)).toEqual({
      cases: 1,
      model_usage: 3_000,
      decide: 500,
      ocr: 1_200,
    });
    const [row] = await withOrg(environment, orgId(org), (tx) =>
      tx
        .select({ cost: cases.costMicroUsd, bytes: cases.captureBytes })
        .from(cases)
        .where(eq(cases.id, caseId)),
    );
    expect(row).toEqual({ cost: 4_700, bytes: 2_048 });
  });

  it("does not count a rerun as a new case, and marks the person who reran it active", async () => {
    const rerun = await owner.call(`/v1/orgs/${org}/cases/${caseId}/rerun`, {
      method: "POST",
    });
    expect(rerun.status).toBe(200);
    const counted = (await usage()).filter((r) => r.feature === "cases");
    expect(counted).toHaveLength(1);
    const seats = await withOrg(environment, orgId(org), (tx) =>
      tx.select().from(seatActivity),
    );
    expect(seats).toMatchObject([
      {
        userId: ownerId,
        role: "operator",
        month: monthOf(new Date()),
      },
    ]);
  });

  it("gives a deploy's developer seat to the person, or the API key's creator", async () => {
    const holder = (actor: Parameters<typeof deploySeatHolder>[1]) =>
      withOrg(environment, orgId(org), (tx) => deploySeatHolder(tx, actor));
    expect(await holder({ actorType: "person", actorId: ownerId })).toBe(
      ownerId,
    );
    expect(await holder({ actorType: "api_key", actorId: keyId })).toBe(
      ownerId,
    );
    expect(
      await holder({ actorType: "platform", actorId: "github:bld_missing" }),
    ).toBeNull();
  });

  it("records nothing on a self-hosted install", async () => {
    const selfHosted: Pick<Env, "PREPROCESS_REGION"> = {};
    await withOrg(environment, orgId(org), (tx) =>
      meter(tx, selfHosted, {
        organizationId: org,
        feature: "cases",
        quantity: 1,
      }),
    );
    expect((await usage()).filter((r) => r.feature === "cases")).toHaveLength(
      1,
    );
  });
});
