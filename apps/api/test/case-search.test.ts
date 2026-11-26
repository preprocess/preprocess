// Case search (spec 10): an agent's search_cases tool finds only its own
// completed cases in its organization and environment, with answers as people
// corrected them and the paths they changed; an eval case sees only cases
// completed before the case it replays started, as they stood then, and never
// that case or one with the same input; deleting a case by hand or by
// retention removes it from search.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import {
  agentGrants,
  agents,
  groupMembers,
  groups,
} from "@preprocess/db/schema/access";
import { cases, caseSearch } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { organizationRetention } from "@preprocess/db/schema/retention";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { searchCases, type SearchRequest } from "../src/case-search.ts";
import { recordCaseEvent } from "../src/cases.ts";
import type { Env, Runtime } from "../src/env.ts";
import { sweepRetention } from "../src/retention.ts";
import type { Client } from "./helpers.ts";
import { addMember, createOrganization, signUp, testEnv } from "./helpers.ts";

type Edit = { caseId: string; path: string; value: unknown };

// The case room's answers, as far as a correction needs them.
const current = new Map<string, Record<string, unknown>>();
const runtime = {
  editAnswer: (e: Edit & { version: number }) => {
    const answers = current.get(e.caseId) ?? {};
    const before = answers[e.path] ?? null;
    current.set(e.caseId, { ...answers, [e.path]: e.value });
    return Promise.resolve({
      result: {
        result: "ok",
        path: e.path,
        before,
        after: e.value,
        stale: [],
        shown: [],
        hidden: [],
      },
      checks: [],
    });
  },
  deleteCase: () => Promise.resolve(),
  deleteCapture: () => Promise.resolve(),
} as unknown as Runtime;

const environment: Env = testEnv({ RUNTIME: runtime });

let owner: Client;
let operator: Client;
let org: string;
let otherOrg: string;

type Agent = { agentId: string; production: string; preview: string };
let invoices: Agent;
let receipts: Agent;
let elsewhere: Agent;

const seedAgent = async (
  organizationId: string,
  slug: string,
  userId: string,
) =>
  withOrg(environment, orgId(organizationId), async (tx) => {
    const agent = {
      agentId: newId("agent"),
      production: newId("deployment"),
      preview: newId("deployment"),
    };
    await tx.insert(agents).values({ id: agent.agentId, organizationId, slug });
    await tx.insert(deployments).values(
      (["production", "preview"] as const).map((env) => ({
        id: env === "production" ? agent.production : agent.preview,
        organizationId,
        agentId: agent.agentId,
        environment: env,
        status: "ready" as const,
        bundleSha256: "00",
        sdkVersion: "0.1.0",
        manifest: {},
        source: "cli" as const,
        createdBy: userId,
      })),
    );
    return agent;
  });

const open = (organizationId: string, agent: Agent, preview = false) =>
  withOrg(environment, orgId(organizationId), async (tx) => {
    const id = newId("case");
    await tx.insert(cases).values({
      id,
      organizationId,
      agentId: agent.agentId,
      deploymentId: preview ? agent.preview : agent.production,
      status: "running",
      source: "api",
      title: `Case ${id}`,
    });
    return id;
  });

const complete = (
  organizationId: string,
  agent: Agent,
  caseId: string,
  text: string,
  answers: Record<string, unknown>,
) => {
  current.set(caseId, answers);
  return recordCaseEvent(environment, {
    organizationId,
    agentId: agent.agentId,
    caseId,
    type: "status",
    status: "completed",
    waitingOn: null,
    reason: null,
    answers,
    error: null,
    completed: {
      input: { text, files: [] },
      captureKey: `${organizationId}/${caseId}/run.v1.json`,
      answer: `Done: ${text}`,
    },
  });
};

// A case completed with that input and answers.
const completed = async (
  agent: Agent,
  text: string,
  answers: Record<string, unknown>,
  options: { organizationId?: string; preview?: boolean } = {},
) => {
  const organizationId = options.organizationId ?? org;
  const id = await open(organizationId, agent, options.preview);
  await complete(organizationId, agent, id, text, answers);
  return id;
};

const correct = async (caseId: string, path: string, value: unknown) => {
  const response = await operator.call(
    `/v1/orgs/${org}/cases/${caseId}/answers`,
    { method: "PATCH", body: { path, version: 1, value } },
  );
  expect(response.status).toBe(200);
};

const search = (
  caseId: string,
  query: string,
  extra: Partial<SearchRequest> = {},
) =>
  searchCases(environment, {
    organizationId: org,
    agentId: invoices.agentId,
    deploymentId: invoices.production,
    caseId,
    query,
    ...extra,
  }).then((r) => r.cases);

const ids = (found: { id: string }[]) => found.map((f) => f.id).sort();
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeAll(async () => {
  const ana = await signUp("Sasha", environment);
  owner = ana.client;
  org = await createOrganization(owner, "Searchco");
  const otto = await signUp("Otto", environment);
  otherOrg = await createOrganization(otto.client, "Elsewhere");
  invoices = await seedAgent(org, "invoices", ana.userId);
  receipts = await seedAgent(org, "receipts", ana.userId);
  elsewhere = await seedAgent(otherOrg, "invoices", otto.userId);
  const op = await addMember(owner, org, "Olga");
  operator = op.client;
  await withOrg(environment, orgId(org), async (tx) => {
    const groupId = newId("group");
    await tx
      .insert(groups)
      .values({ id: groupId, organizationId: org, slug: "ap", name: "AP" });
    await tx
      .insert(groupMembers)
      .values({ organizationId: org, groupId, userId: op.userId });
    await tx.insert(agentGrants).values({
      organizationId: org,
      agentId: invoices.agentId,
      groupId,
      access: "operator",
      grantedBy: ana.userId,
    });
  });
});

describe("scoping", () => {
  it("finds only the same agent's completed cases in its organization and environment", async () => {
    const mine = await completed(invoices, "Invoice from Zephyr Ltd", {
      vendor: "Zephyr Ltd",
    });
    const second = await completed(invoices, "Second Zephyr invoice", {
      vendor: "Zephyr Ltd",
    });
    await completed(receipts, "Zephyr receipt", { vendor: "Zephyr Ltd" });
    await completed(
      invoices,
      "Zephyr invoice on a preview",
      { vendor: "Zephyr Ltd" },
      { preview: true },
    );
    await completed(
      elsewhere,
      "Zephyr invoice elsewhere",
      { vendor: "Zephyr Ltd" },
      { organizationId: otherOrg },
    );
    await open(org, invoices);
    const searching = await open(org, invoices);

    const found = await search(searching, "zephyr");
    expect(ids(found)).toEqual([mine, second].sort());
    expect(found.find((f) => f.id === mine)).toMatchObject({
      input: "Invoice from Zephyr Ltd",
      answer: "Done: Invoice from Zephyr Ltd",
      answers: { vendor: "Zephyr Ltd" },
      changed: [],
    });

    const preview = await search(searching, "zephyr", {
      deploymentId: invoices.preview,
    });
    expect(preview).toHaveLength(1);
    expect(preview[0]!.input).toBe("Zephyr invoice on a preview");
  });

  it("never finds the searching case, a case that is no longer completed, or anything through another agent's deployment", async () => {
    const self = await completed(invoices, "Quokka invoice", { n: 1 });
    expect(await search(self, "quokka")).toEqual([]);
    const other = await open(org, invoices);
    expect(ids(await search(other, "quokka"))).toEqual([self]);
    await withOrg(environment, orgId(org), (tx) =>
      tx.update(cases).set({ status: "running" }).where(eq(cases.id, self)),
    );
    expect(await search(other, "quokka")).toEqual([]);
    expect(
      await search(other, "zephyr", { deploymentId: receipts.production }),
    ).toEqual([]);
  });

  it("caps results at ten and ignores a query with no words", async () => {
    for (let i = 0; i < 12; i++)
      await completed(invoices, `Wombat invoice ${i}`, { i });
    const searching = await open(org, invoices);
    expect(await search(searching, "wombat", { limit: 50 })).toHaveLength(10);
    expect(await search(searching, "wombat")).toHaveLength(5);
    expect(await search(searching, "  !!! ")).toEqual([]);
  });
});

describe("corrections", () => {
  it("give the corrected answer, mark the changed path and make the new value searchable", async () => {
    const id = await completed(invoices, "Invoice from Kestrel", {
      vendor: "Kestrl",
      total: 10,
    });
    await correct(id, "vendor", "Kestrel Partners");
    const searching = await open(org, invoices);
    const [found] = await search(searching, "partners");
    expect(found).toMatchObject({
      id,
      answers: { vendor: "Kestrel Partners", total: 10 },
      changed: ["vendor"],
    });
  });
});

describe("evals", () => {
  it("see only cases completed before the replayed case started, as they stood then, never it or one with the same input", async () => {
    const before = await completed(invoices, "Pelican invoice 1", {
      vendor: "Pelican",
      total: 1,
    });
    const corrected = await completed(invoices, "Pelican invoice 2", {
      vendor: "Pelican",
      total: 2,
    });
    const onlyLater = await completed(invoices, "Invoice 3", {
      vendor: "Unknown",
    });
    const sameInput = await completed(invoices, "Pelican invoice 9", {
      vendor: "Pelican",
      total: 9,
    });
    await correct(corrected, "total", 20);
    await tick();
    const replayed = await open(org, invoices);
    await tick();
    await correct(corrected, "total", 200);
    await correct(onlyLater, "vendor", "Pelican");
    await complete(org, invoices, replayed, "Pelican invoice 9", {
      vendor: "Pelican",
      total: 9,
    });
    await tick();
    const after = await completed(invoices, "Pelican invoice 4", {
      vendor: "Pelican",
    });

    const live = await open(org, invoices);
    expect(ids(await search(live, "pelican", { limit: 10 }))).toEqual(
      [before, corrected, onlyLater, sameInput, replayed, after].sort(),
    );

    const found = await search(`eval:run:${replayed}`, "pelican", {
      limit: 10,
      eval: { sourceCaseId: replayed, input: "Pelican invoice 9" },
    });
    expect(ids(found)).toEqual([before, corrected].sort());
    expect(found.find((f) => f.id === corrected)).toMatchObject({
      answers: { vendor: "Pelican", total: 20 },
      changed: ["total"],
    });
  });

  it("rewind a path first changed after the cutoff to the agent's value and unmark it", async () => {
    const id = await completed(invoices, "Heron invoice", {
      vendor: "Heron",
      total: 5,
    });
    await tick();
    const replayed = await open(org, invoices);
    await tick();
    await correct(id, "total", 50);
    const [found] = await search(`eval:run:${replayed}`, "heron", {
      eval: { sourceCaseId: replayed, input: "another heron" },
    });
    expect(found).toMatchObject({
      id,
      answers: { vendor: "Heron", total: 5 },
      changed: [],
    });
  });
});

describe("deletion", () => {
  const rows = async (caseId: string) =>
    withOrg(environment, orgId(org), (tx) =>
      tx.select().from(caseSearch).where(eq(caseSearch.caseId, caseId)),
    );

  it("by an Owner removes the case from search", async () => {
    const id = await completed(invoices, "Ibis invoice", { vendor: "Ibis" });
    expect(await rows(id)).toHaveLength(1);
    expect(
      (await owner.call(`/v1/orgs/${org}/cases/${id}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
    expect(await rows(id)).toEqual([]);
    expect(await search(await open(org, invoices), "ibis")).toEqual([]);
  });

  it("by the retention sweep removes cases past the period and keeps the rest", async () => {
    const old = await completed(invoices, "Old Egret invoice", {
      vendor: "Egret",
    });
    const recent = await completed(invoices, "New Egret invoice", {
      vendor: "Egret",
    });
    await withOrg(environment, orgId(org), async (tx) => {
      await tx
        .update(cases)
        .set({ completedAt: new Date(Date.now() - 40 * 86_400_000) })
        .where(eq(cases.id, old));
      await tx
        .insert(organizationRetention)
        .values({ organizationId: org, casesDays: 30, updatedBy: "test" });
    });
    await sweepRetention(environment);
    expect(await rows(old)).toEqual([]);
    expect(ids(await search(await open(org, invoices), "egret"))).toEqual([
      recent,
    ]);
  });
});
