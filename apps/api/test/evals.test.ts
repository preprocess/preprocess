// Evals (design doc 09): completed cases join the agent's automatic suite
// with their input, corrected and original answers; the cap keeps the newest;
// a run starts one eval case per suite case and model; eval cases are scored
// field by field; eval spend counts toward the spending limit; and only
// Developers, Admins and Owners reach any of it, in their own organization.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { cases, reviewEvents } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { evalRuns, evalSuiteCases } from "@preprocess/db/schema/evals";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { recordCaseEvent } from "../src/cases.ts";
import type { Env, Runtime, StartCase } from "../src/env.ts";
import {
  evalCaseId,
  fieldScorer,
  recordEvalEvent,
  scoreAnswers,
  startQueuedEval,
} from "../src/evals.ts";
import type { OutboxMessage } from "../src/outbox.ts";
import type { Client } from "./helpers.ts";
import { addMember, createOrganization, signUp, testEnv } from "./helpers.ts";

const queued: OutboxMessage[] = [];
const started: StartCase[] = [];

const runtime = {
  startCase: (start: StartCase) => {
    started.push(start);
    return Promise.resolve({});
  },
} as unknown as Runtime;

const environment: Env = testEnv({
  RUNTIME: runtime,
  CASES: {
    send: (message: OutboxMessage) => {
      queued.push(message);
      return Promise.resolve();
    },
  } as unknown as Queue<OutboxMessage>,
});

type Suite = {
  id: string;
  kind: string;
  cap: number | null;
  cases: number;
  error?: { code: string };
};
type SuiteDetail = Suite & {
  suiteCases: {
    caseId: string;
    input: unknown;
    expected: unknown;
    original: unknown;
  }[];
};
type Run = {
  id: string;
  model: string;
  status: string;
  cases: number;
  passed: number;
  failed: number;
  neededPerson: number;
  passRate: number | null;
};
type RunDetail = Run & {
  fields: { path: string; matchRate: number }[];
  results: { caseId: string; status: string; reason: string | null }[];
};

let owner: Client;
let member: Client;
let other: Client;
let org: string;
let otherOrg: string;
const agentId = newId("agent");
const deploymentId = newId("deployment");
const caseIds = [newId("case"), newId("case"), newId("case"), newId("case")];

const answers = (i: number) => ({
  vendor: "Acme Corp",
  invoice: { number: `INV-${i}`, total: 100 + i },
});

const complete = (caseId: string, i: number) =>
  recordCaseEvent(environment, {
    organizationId: org,
    agentId,
    caseId,
    type: "status",
    status: "completed",
    waitingOn: null,
    reason: null,
    answers: answers(i),
    error: null,
    completed: {
      input: { text: `Invoice ${i}`, files: [] },
      captureKey: `${org}/agents/${agentId}/cases/${caseId}/run.v1.json`,
    },
  });

const suites = async () =>
  (
    await owner.call<{ suites: Suite[] }>(
      `/v1/orgs/${org}/agents/invoices/eval-suites`,
    )
  ).body.suites;

beforeAll(async () => {
  const ana = await signUp("Eva", environment);
  owner = ana.client;
  org = await createOrganization(owner, "Eval Acme");
  member = (await addMember(owner, org, "Mel")).client;
  other = (await signUp("Otto", environment)).client;
  otherOrg = await createOrganization(other, "Eval Globex");
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
      createdBy: ana.userId,
      promotedAt: new Date(),
    });
    await tx.insert(cases).values(
      caseIds.map((id) => ({
        id,
        organizationId: org,
        agentId,
        deploymentId,
        status: "running" as const,
        source: "api" as const,
      })),
    );
    await tx.insert(reviewEvents).values({
      id: newId("reviewEvent"),
      organizationId: org,
      caseId: caseIds[0]!,
      userId: ana.userId,
      kind: "edit",
      path: "invoice.total",
      before: 99,
      after: 100,
    });
  });
});

describe("the field scorer", () => {
  it("ignores case and whitespace in strings, and nothing else", () => {
    expect(
      fieldScorer.score({ path: "a" }, " Acme  Corp", "acme corp").match,
    ).toBe(true);
    expect(fieldScorer.score({ path: "a" }, 100, 100.5).match).toBe(false);
    expect(fieldScorer.score({ path: "a" }, true, "true").match).toBe(false);
    expect(
      fieldScorer.score({ path: "a" }, [{ sku: "A1" }], [{ sku: " a1 " }])
        .match,
    ).toBe(true);
    expect(
      scoreAnswers({ a: 1, b: { c: "X" } }, { a: 1, b: { c: "y" } }).map(
        (f) => [f.path, f.match],
      ),
    ).toEqual([
      ["a", true],
      ["b.c", false],
    ]);
  });
});

describe("the automatic suite", () => {
  it("is created with the first completed case and keeps the corrected and original answers", async () => {
    await complete(caseIds[0]!, 0);
    const [suite] = await suites();
    expect(suite).toMatchObject({ kind: "automatic", cap: 100, cases: 1 });
    const detail = await owner.call<SuiteDetail>(
      `/v1/orgs/${org}/eval-suites/${suite!.id}`,
    );
    expect(detail.body.suiteCases[0]).toMatchObject({
      caseId: caseIds[0],
      input: { text: "Invoice 0" },
      expected: answers(0),
      original: {
        vendor: "Acme Corp",
        invoice: { number: "INV-0", total: 99 },
      },
    });
  });

  it("never takes a failed case", async () => {
    await recordCaseEvent(environment, {
      organizationId: org,
      agentId,
      caseId: caseIds[3]!,
      type: "status",
      status: "failed",
      waitingOn: null,
      reason: null,
      answers: null,
      error: { code: "run_failed", message: "x" },
    });
    expect((await suites())[0]!.cases).toBe(1);
  });

  it("keeps only the newest cases under its cap", async () => {
    await complete(caseIds[1]!, 1);
    await complete(caseIds[2]!, 2);
    const [suite] = await suites();
    expect(suite!.cases).toBe(3);
    const patched = await owner.call<Suite>(
      `/v1/orgs/${org}/eval-suites/${suite!.id}`,
      { method: "PATCH", body: { cap: 2 } },
    );
    expect(patched.body).toMatchObject({ cap: 2, cases: 2 });
    const detail = await owner.call<SuiteDetail>(
      `/v1/orgs/${org}/eval-suites/${suite!.id}`,
    );
    expect(detail.body.suiteCases.map((c) => c.caseId).sort()).toEqual(
      [caseIds[1], caseIds[2]].sort(),
    );
    for (const cap of [0, 1001])
      expect(
        (
          await owner.call(`/v1/orgs/${org}/eval-suites/${suite!.id}`, {
            method: "PATCH",
            body: { cap },
          })
        ).status,
      ).toBe(400);
  });

  it("is only for Developers, Admins and Owners, in their own organization", async () => {
    const [suite] = await suites();
    expect(
      (await member.call(`/v1/orgs/${org}/agents/invoices/eval-suites`)).status,
    ).toBe(403);
    expect(
      (await member.call(`/v1/orgs/${org}/eval-suites/${suite!.id}`)).status,
    ).toBe(403);
    expect(
      (await other.call(`/v1/orgs/${otherOrg}/eval-suites/${suite!.id}`))
        .status,
    ).toBe(404);
    expect(
      (await other.call(`/v1/orgs/${org}/eval-suites/${suite!.id}`)).status,
    ).toBe(403);
  });
});

describe("eval runs", () => {
  let runs: Run[];

  it("start one eval case per suite case and model through the queue", async () => {
    const [suite] = await suites();
    const res = await owner.call<{ runs: Run[] }>(
      `/v1/orgs/${org}/eval-suites/${suite!.id}/runs`,
      { body: { models: ["model-a", "model-b"] } },
    );
    expect(res.status).toBe(202);
    runs = res.body.runs;
    expect(runs.map((r) => [r.model, r.status, r.cases]).sort()).toEqual([
      ["model-a", "running", 2],
      ["model-b", "running", 2],
    ]);
    const evalStarts = queued.filter((m) => m.kind === "eval.start");
    expect(evalStarts).toHaveLength(4);
    for (const message of evalStarts)
      await startQueuedEval(environment, message);
    expect(started).toHaveLength(4);
    const first = started.find(
      (s) =>
        s.eval?.runId === runs[0]!.id && s.eval.sourceCaseId === caseIds[1],
    )!;
    expect(first).toMatchObject({
      organizationId: org,
      agentId,
      caseId: evalCaseId(runs[0]!.id, caseIds[1]!),
      deploymentId,
      input: { text: "Invoice 1" },
      settings: { model: runs[0]!.model },
    });
  });

  it("score each eval case and finish the run", async () => {
    const run = runs[0]!;
    const event = (caseId: string) => ({
      organizationId: org,
      agentId,
      caseId: evalCaseId(run.id, caseId),
      runId: run.id,
      sourceCaseId: caseId,
      waitingOn: null,
      reason: null,
      costMicroUsd: 250_000,
      captureKey: "k",
    });
    await recordEvalEvent(environment, {
      ...event(caseIds[1]!),
      status: "completed",
      answers: {
        vendor: "ACME  corp",
        invoice: { number: "inv-1", total: 101 },
      },
    });
    let detail = await owner.call<RunDetail>(
      `/v1/orgs/${org}/eval-runs/${run.id}`,
    );
    expect(detail.body).toMatchObject({ status: "running", passed: 1 });
    await recordEvalEvent(environment, {
      ...event(caseIds[2]!),
      status: "completed",
      answers: { vendor: "Acme Corp", invoice: { number: "INV-2", total: 3 } },
    });
    detail = await owner.call<RunDetail>(`/v1/orgs/${org}/eval-runs/${run.id}`);
    expect(detail.body).toMatchObject({
      status: "completed",
      cases: 2,
      passed: 1,
      failed: 1,
      passRate: 0.5,
    });
    expect(detail.body.fields).toEqual([
      { path: "invoice.number", matchRate: 1 },
      { path: "invoice.total", matchRate: 0.5 },
      { path: "vendor", matchRate: 1 },
    ]);
    // A settled result is never scored again.
    await recordEvalEvent(environment, {
      ...event(caseIds[2]!),
      status: "completed",
      answers: answers(2),
    });
    detail = await owner.call<RunDetail>(`/v1/orgs/${org}/eval-runs/${run.id}`);
    expect(detail.body.passed).toBe(1);
  });

  it("count a wait on a group as needing a person", async () => {
    const run = runs[1]!;
    await recordEvalEvent(environment, {
      organizationId: org,
      agentId,
      caseId: evalCaseId(run.id, caseIds[1]!),
      runId: run.id,
      sourceCaseId: caseIds[1]!,
      status: "waiting",
      waitingOn: "accounts-payable",
      reason: "approval over 1000",
      answers: null,
      costMicroUsd: 0,
      captureKey: "k",
    });
    const detail = await owner.call<RunDetail>(
      `/v1/orgs/${org}/eval-runs/${run.id}`,
    );
    expect(detail.body.neededPerson).toBe(1);
    expect(
      detail.body.results.find((r) => r.caseId === caseIds[1])?.status,
    ).toBe("needed_person");
  });

  it("show eval spend on its own line and count it toward the limit", async () => {
    const spending = await owner.call<{ spentUsd: number; evalsUsd: number }>(
      `/v1/orgs/${org}/spending`,
    );
    expect(spending.body).toMatchObject({ evalsUsd: 0.5, spentUsd: 0.5 });
    await owner.call(`/v1/orgs/${org}/spending/limit`, {
      method: "PUT",
      body: { limitUsd: 0.5 },
    });
    const [suite] = await suites();
    const refused = await owner.call<{ error: { code: string } }>(
      `/v1/orgs/${org}/eval-suites/${suite!.id}/runs`,
      { body: {} },
    );
    expect(refused.status).toBe(402);
    await owner.call(`/v1/orgs/${org}/spending/limit`, {
      method: "PUT",
      body: { limitUsd: null },
    });
  });

  it("drop a deleted case from its suites", async () => {
    await withOrg(environment, orgId(org), async (tx) => {
      await tx.delete(evalRuns).where(eq(evalRuns.organizationId, org));
      await tx.delete(cases).where(eq(cases.id, caseIds[2]!));
      const left = await tx
        .select({ caseId: evalSuiteCases.caseId })
        .from(evalSuiteCases);
      expect(left.map((r) => r.caseId)).toEqual([caseIds[1]]);
    });
  });
});
