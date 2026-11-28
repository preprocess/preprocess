// Deleting an organization (purge.ts): every R2 object and Durable Object
// it owns is gone once its purge completes, another organization's are
// untouched, the purge is safe to run again, a stalled one is sent again, and
// completion is one log line with ids and counts only.

import { orgId, withoutOrg, type OrgId } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { cases } from "@preprocess/db/schema/cases";
import {
  githubBuilds,
  githubInstallations,
  githubLinks,
  githubRepositories,
} from "@preprocess/db/schema/github";
import {
  organizationPurgeObjects,
  organizationPurges,
} from "@preprocess/db/schema/purges";
import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { queueName } from "../src/builds.ts";
import type { Env, Job } from "../src/env.ts";
import { purgeStep, resumePurges, runPurgeJob } from "../src/purge.ts";
import { schedulerName } from "../src/scheduler.ts";
import { Client, createOrganization, signUp, testEnv } from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import scheduledAgent from "./dist/scheduled-agent.js?raw";

// Purge messages the delete sends, run by the test instead of the queue.
const jobs: Job[] = [];
const environment: Env = testEnv({
  JOBS: {
    send: (body: Job) => {
      jobs.push(body);
      return Promise.resolve();
    },
    sendBatch: (messages: { body: Job }[]) => {
      jobs.push(...messages.map((m) => m.body));
      return Promise.resolve();
    },
  } as unknown as Env["JOBS"],
});

type Seeded = {
  org: OrgId;
  owner: Client;
  agentId: string;
  previewId: string;
  caseId: string;
  keys: { bucket: R2Bucket; key: string }[];
};

const eventually = async <T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
) => {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting");
};

const scheduler = (s: Seeded, previewId?: string) =>
  env.SCHEDULER.getByName(schedulerName(s.org, s.agentId, previewId));
const builds = (s: Seeded) =>
  env.BUILDS.getByName(queueName(s.org, "reconciler", "main"));
const caseKey = (s: Seeded) => ({
  organizationId: s.org,
  agentId: s.agentId,
  caseId: s.caseId,
});

// What a Durable Object still holds.
const held = (stub: DurableObjectStub) =>
  runInDurableObject(stub, async (_: unknown, state) => ({
    keys: [...(await state.storage.list()).keys()],
    alarm: await state.storage.getAlarm(),
  }));

// An organization with one of each: a case that ran (its object and run
// capture), production and preview schedulers, a build queue, a deployed
// bundle, and objects under every prefix it owns.
const seed = async (name: string): Promise<Seeded> => {
  const { client: owner, userId } = await signUp(name, environment);
  const org = orgId(await createOrganization(owner, name));
  const created = await owner.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "deploy", organizationId: org } },
  );
  const key = new Client(environment, {
    authorization: `Bearer ${created.body.key}`,
  });
  const deploy = (branch: string) =>
    key.call<{ id: string; agentId: string }>(
      `/v1/orgs/${org}/agents/reconciler/deployments`,
      {
        method: "POST",
        body: {
          bundle: {
            mainModule: "agent.js",
            modules: { "agent.js": scheduledAgent },
          },
          git: { branch },
        },
      },
    );
  const production = await deploy("main");
  expect(production.status).toBe(201);
  const preview = await deploy("feature");
  expect(preview.status).toBe(201);
  const agentId = production.body.agentId;

  // The nightly schedule fires a real case, which runs to its end.
  const nightly = env.SCHEDULER.getByName(schedulerName(org, agentId));
  await runInDurableObject(nightly, async (_: unknown, state) => {
    const runs =
      (await state.storage.get<Record<string, { next: string }>>("runs"))!;
    runs["nightly-reconcile"]!.next = "2026-11-20T07:00:00.000Z";
    await state.storage.put("runs", runs);
    await state.storage.setAlarm(Date.parse("2100-01-01T00:00:00.000Z"));
  });
  expect(await runDurableObjectAlarm(nightly)).toBe(true);
  const [made] = await withoutOrg(environment, "test: purge", (tx) =>
    tx
      .select({ id: cases.id })
      .from(cases)
      .where(eq(cases.organizationId, org)),
  );
  const s: Seeded = {
    org,
    owner,
    agentId,
    previewId: preview.body.id,
    caseId: made!.id,
    keys: [],
  };
  await eventually(
    () => env.RUNTIME.readCapture(caseKey(s)).catch(() => null),
    (capture) => capture !== null,
  );

  await withoutOrg(environment, "test: purge", async (tx) => {
    const installationId = newId("githubInstallation");
    await tx.insert(githubInstallations).values({
      id: installationId,
      organizationId: org,
      installationId: Math.floor(Math.random() * 2 ** 40),
      accountLogin: name.toLowerCase(),
      accountType: "Organization",
      createdBy: userId,
    });
    const repositoryId = newId("githubRepository");
    await tx.insert(githubRepositories).values({
      id: repositoryId,
      organizationId: org,
      installationId,
      repositoryId: Math.floor(Math.random() * 2 ** 40),
      fullName: `${name.toLowerCase()}/agents`,
      private: true,
    });
    const linkId = newId("githubLink");
    await tx.insert(githubLinks).values({
      id: linkId,
      organizationId: org,
      repositoryId,
      agentSlug: "reconciler",
      createdBy: userId,
    });
    await tx.insert(githubBuilds).values({
      id: newId("githubBuild"),
      organizationId: org,
      linkId,
      agentSlug: "reconciler",
      branch: "main",
      commit: "abc1234",
      status: "queued",
    });
  });
  await runInDurableObject(builds(s), async (_: unknown, state) => {
    await state.storage.put("next", { organizationId: org, buildId: "b" });
  });

  const objects: [R2Bucket, string][] = [
    [env.FILES, `${org}/files/${newId("file")}`],
    [env.FILES, `${org}/jobs/job.json`],
    [env.FILES, `support/${org}/request/attachment`],
    [env.LOG_BUCKET, `${org}/2026-11-27/${agentId}/${s.caseId}/log.ndjson`],
    [env.RUNS, `${org}/agents/${agentId}/cases/other/run.v1.json`],
    [env.BUNDLES, `org/${org}/layers/${"0".repeat(64)}`],
  ];
  for (const [bucket, k] of objects) {
    await bucket.put(k, "x");
    s.keys.push({ bucket, key: k });
  }
  return s;
};

// Everything under the organization's prefixes in every bucket.
const stored = async (org: string) => {
  const prefixes: [R2Bucket, string][] = [
    [env.FILES, `${org}/`],
    [env.FILES, `support/${org}/`],
    [env.LOG_BUCKET, `${org}/`],
    [env.RUNS, `${org}/`],
    [env.BUNDLES, `${org}/`],
    [env.BUNDLES, `org/${org}/`],
  ];
  const keys: string[] = [];
  for (const [bucket, prefix] of prefixes)
    keys.push(...(await bucket.list({ prefix })).objects.map((o) => o.key));
  return keys;
};

const purgeRow = (org: string) =>
  withoutOrg(environment, "test: purge", async (tx) => {
    const [row] = await tx
      .select()
      .from(organizationPurges)
      .where(eq(organizationPurges.organizationId, org));
    return row;
  });

let doomed: Seeded;
let kept: Seeded;
let logged: unknown[] = [];

beforeAll(async () => {
  doomed = await seed("Doomed");
  kept = await seed("Kept");
});

describe("deleting an organization", () => {
  it("seeds every kind of object it owns", async () => {
    expect((await stored(doomed.org)).length).toBeGreaterThanOrEqual(8);
    expect((await held(scheduler(doomed))).keys).not.toEqual([]);
    expect((await held(scheduler(doomed, doomed.previewId))).keys).not.toEqual(
      [],
    );
    expect((await held(builds(doomed))).keys).toEqual(["next"]);
    expect(await env.RUNTIME.getCase(caseKey(doomed))).toBeTruthy();
  });

  it("names its Durable Objects before the cascade and queues the purge once committed", async () => {
    const deleted = await doomed.owner.call("/api/auth/organization/delete", {
      body: { organizationId: doomed.org },
    });
    expect(deleted.status).toBe(200);
    expect(jobs).toEqual([
      { kind: "organization.purge", organizationId: doomed.org },
    ]);
    const named = await withoutOrg(environment, "test: purge", (tx) =>
      tx
        .select()
        .from(organizationPurgeObjects)
        .where(eq(organizationPurgeObjects.organizationId, doomed.org)),
    );
    expect(named.map((o) => [o.kind, o.agent, o.name]).sort()).toEqual(
      [
        ["builds", "reconciler", "main"],
        ["case", doomed.agentId, doomed.caseId],
        ["scheduler", doomed.agentId, ""],
        ["scheduler", doomed.agentId, doomed.previewId],
      ].sort(),
    );
    expect((await purgeRow(doomed.org))?.completedAt).toBeNull();
  });

  it("removes every R2 object and Durable Object state it owned", async () => {
    const log = vi.spyOn(console, "log");
    await runPurgeJob(environment, jobs[0] as Extract<Job, { kind: string }>);
    logged = log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('"organization.purged"'))
      .map((line) => JSON.parse(line) as unknown);
    log.mockRestore();

    expect(await stored(doomed.org)).toEqual([]);
    for (const stub of [
      scheduler(doomed),
      scheduler(doomed, doomed.previewId),
      builds(doomed),
    ])
      expect(await held(stub)).toEqual({ keys: [], alarm: null });
    expect(
      await env.RUNTIME.getCase(caseKey(doomed)).then(
        () => "held",
        () => "gone",
      ),
    ).toBe("gone");
    expect(await env.RUNTIME.readCapture(caseKey(doomed))).toBeNull();
    const named = await withoutOrg(environment, "test: purge", (tx) =>
      tx
        .select()
        .from(organizationPurgeObjects)
        .where(eq(organizationPurgeObjects.organizationId, doomed.org)),
    );
    expect(named).toEqual([]);
  });

  it("records completion with ids and counts only", async () => {
    const row = await purgeRow(doomed.org);
    expect(row?.completedAt).toBeInstanceOf(Date);
    expect(row?.counts).toMatchObject({
      case: 1,
      scheduler: 2,
      builds: 1,
    });
    // The case's own capture goes with its object; its run's logs and the
    // deployments' bundles add to what was seeded.
    expect(row?.counts.files).toBe(3);
    expect(row?.counts.logs).toBeGreaterThanOrEqual(1);
    expect(row?.counts.runs).toBe(1);
    expect(row?.counts.bundles).toBe(3);
    expect(logged).toEqual([
      {
        event: "organization.purged",
        organizationId: doomed.org,
        requestedAt: row!.requestedAt.toISOString(),
        completedAt: row!.completedAt!.toISOString(),
        counts: row!.counts,
      },
    ]);
  });

  it("is safe to run again", async () => {
    const before = await purgeRow(doomed.org);
    expect(await purgeStep(environment, doomed.org)).toBe("none");
    await runPurgeJob(environment, {
      kind: "organization.purge",
      organizationId: doomed.org,
    });
    expect(await purgeRow(doomed.org)).toEqual(before);
    expect(await stored(doomed.org)).toEqual([]);
  });

  it("leaves another organization's objects alone", async () => {
    const left = await stored(kept.org);
    for (const { key } of kept.keys) expect(left).toContain(key);
    expect((await held(scheduler(kept))).keys).not.toEqual([]);
    expect((await held(builds(kept))).keys).toEqual(["next"]);
    expect(await env.RUNTIME.getCase(caseKey(kept))).toBeTruthy();
  });

  it("refuses an id that could widen a prefix", async () => {
    await expect(purgeStep(environment, "")).rejects.toThrow(/refusing/);
    await expect(purgeStep(environment, "org/../")).rejects.toThrow(/refusing/);
  });
});

describe("a stalled purge", () => {
  it("is sent again by the minute cron", async () => {
    const org = newId("organization");
    await withoutOrg(environment, "test: purge", (tx) =>
      tx.insert(organizationPurges).values({
        organizationId: org,
        requestedAt: new Date(Date.now() - 3_600_000),
      }),
    );
    jobs.length = 0;
    await resumePurges(environment);
    expect(jobs).toContainEqual({
      kind: "organization.purge",
      organizationId: org,
    });
    expect(jobs).not.toContainEqual({
      kind: "organization.purge",
      organizationId: doomed.org,
    });
    await runPurgeJob(environment, {
      kind: "organization.purge",
      organizationId: org,
    });
    expect((await purgeRow(org))?.completedAt).toBeInstanceOf(Date);
    jobs.length = 0;
    await resumePurges(environment);
    expect(jobs).not.toContainEqual({
      kind: "organization.purge",
      organizationId: org,
    });
  });
});
