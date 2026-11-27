// Run capture read and export (design doc 10): who may read a case's capture
// and review events, who may export an agent's cases, the 409/410 states,
// paging, filters, the capture.exported audit event, and another
// organization reaching none of it.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import {
  agentGrants,
  agents,
  groupMembers,
  groups,
} from "@preprocess/db/schema/access";
import { cases, reviewEvents } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import type { Env, RunCapture, Runtime } from "../src/env.ts";
import { fixtureCapture } from "./fixtures/capture.ts";
import {
  addMember,
  callStream,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";

type Key = { organizationId: string; agentId: string; caseId: string };

// The runtime's RUNS bucket, as readCapture sees it.
const stored = new Map<string, RunCapture>();
const read: Key[] = [];
const runtime = {
  readCapture: (k: Key) => {
    read.push(k);
    return Promise.resolve(
      stored.get(`${k.organizationId}/${k.agentId}/${k.caseId}`) ?? null,
    );
  },
} as unknown as Runtime;
const environment: Env = testEnv({ RUNTIME: runtime });

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

type Line = {
  case?: { id: string; status: string; model: string | null };
  capture?: RunCapture | null;
  reviewEvents?: { kind: string; path: string | null }[];
  next?: string | null;
  skipped?: number;
};
const lines = (body: unknown) =>
  String(body)
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Line);

type Seeded = {
  org: string;
  agentId: string;
  completed: string;
  failed: string;
  cancelled: string;
  running: string;
  purged: string;
  older: string;
};

const seed = async (org: string, userId: string): Promise<Seeded> => {
  const agentId = newId("agent");
  const deploymentId = newId("deployment");
  const s: Seeded = {
    org,
    agentId,
    completed: newId("case"),
    failed: newId("case"),
    cancelled: newId("case"),
    running: newId("case"),
    purged: newId("case"),
    older: newId("case"),
  };
  const base = {
    organizationId: org,
    agentId,
    deploymentId,
    source: "api" as const,
  };
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
      createdBy: userId,
      promotedAt: new Date(),
    });
    await tx.insert(cases).values([
      {
        ...base,
        id: s.older,
        status: "completed",
        createdAt: ago(20),
        completedAt: ago(20),
      },
      {
        ...base,
        id: s.completed,
        status: "completed",
        createdAt: ago(5),
        completedAt: ago(5),
      },
      {
        ...base,
        id: s.failed,
        status: "failed",
        createdAt: ago(4),
        completedAt: ago(4),
      },
      {
        ...base,
        id: s.cancelled,
        status: "cancelled",
        createdAt: ago(3),
        updatedAt: ago(3),
      },
      {
        ...base,
        id: s.purged,
        status: "completed",
        createdAt: ago(2),
        completedAt: ago(2),
        capturePurgedAt: ago(1),
      },
      { ...base, id: s.running, status: "running", createdAt: ago(1) },
    ]);
    await tx.insert(reviewEvents).values([
      {
        id: newId("reviewEvent"),
        organizationId: org,
        caseId: s.completed,
        userId,
        kind: "field.edited",
        path: "total",
        before: 12,
        after: 120,
        at: ago(4.9),
      },
      {
        id: newId("reviewEvent"),
        organizationId: org,
        caseId: s.completed,
        userId,
        kind: "completed",
        at: ago(4.8),
      },
    ]);
  });
  for (const caseId of [s.older, s.completed, s.failed, s.purged])
    stored.set(
      `${org}/${agentId}/${caseId}`,
      fixtureCapture({ organizationId: org, agentId, deploymentId, caseId }),
    );
  return s;
};

let owner: Client;
let developer: Client;
let viewer: Client;
let outsider: Client;
let keyed: Client;
let otherOwner: Client;
let a: Seeded;
let b: Seeded;

beforeAll(async () => {
  const ana = await signUp("Cass Owner", environment);
  owner = ana.client;
  const org = await createOrganization(owner, "Captureco");
  const dev = await addMember(owner, org, "Dee Developer");
  developer = dev.client;
  const vic = await addMember(owner, org, "Vic Viewer");
  viewer = vic.client;
  outsider = (await addMember(owner, org, "Ola Outsider")).client;
  const key = await owner.call<{ key: string }>("/api/auth/api-key/create", {
    body: { name: "ci", organizationId: org },
  });
  keyed = new Client(environment, { "x-api-key": key.body.key });
  const other = await signUp("Oren Other", environment);
  otherOwner = other.client;
  const otherOrg = await createOrganization(otherOwner, "Elsewhere");

  a = await seed(org, ana.userId);
  b = await seed(otherOrg, other.userId);

  const all = await owner.call<{ id: string; isDevelopers: boolean }[]>(
    `/v1/orgs/${org}/groups`,
  );
  await owner.call(
    `/v1/orgs/${org}/groups/${all.body.find((g) => g.isDevelopers)!.id}/members/${dev.userId}`,
    { method: "PUT" },
  );
  const watchers = newId("group");
  await withOrg(environment, orgId(org), async (tx) => {
    await tx.insert(groups).values({
      id: watchers,
      organizationId: org,
      slug: "watchers",
      name: "Watchers",
    });
    await tx
      .insert(groupMembers)
      .values({ organizationId: org, groupId: watchers, userId: vic.userId });
    await tx.insert(agentGrants).values({
      organizationId: org,
      agentId: a.agentId,
      groupId: watchers,
      access: "viewer",
      grantedBy: ana.userId,
    });
  });
});

const capture = (client: Client, s: Seeded, caseId: string) =>
  client.call<RunCapture & { error?: { code: string } }>(
    `/v1/orgs/${s.org}/cases/${caseId}/capture`,
  );

describe("a case's run capture", () => {
  it("is returned as stored to anyone who can see the case", async () => {
    for (const client of [owner, developer, viewer, keyed]) {
      const res = await capture(client, a, a.completed);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        stored.get(`${a.org}/${a.agentId}/${a.completed}`),
      );
    }
  });

  it("is hidden from a member who cannot see the agent's cases", async () => {
    expect((await capture(outsider, a, a.completed)).status).toBe(404);
  });

  it("answers 409 while the case runs, 410 once retention deleted it, 404 when none was stored", async () => {
    const running = await capture(owner, a, a.running);
    expect(running.status).toBe(409);
    expect(running.body.error?.code).toBe("capture_not_ready");
    const purged = await capture(owner, a, a.purged);
    expect(purged.status).toBe(410);
    expect(purged.body.error?.code).toBe("capture_purged");
    const cancelled = await capture(owner, a, a.cancelled);
    expect(cancelled.status).toBe(404);
    expect(cancelled.body.error?.code).toBe("capture_not_found");
    expect((await capture(owner, a, "case_unknown")).status).toBe(404);
  });

  it("is never another organization's", async () => {
    expect((await capture(otherOwner, a, a.completed)).status).toBe(403);
    expect(
      (await otherOwner.call(`/v1/orgs/${b.org}/cases/${a.completed}/capture`))
        .status,
    ).toBe(404);
    expect(
      read.some((k) => k.organizationId === b.org && k.caseId === a.completed),
    ).toBe(false);
  });
});

describe("a case's review events", () => {
  it("come in order to anyone who can see the case", async () => {
    const res = await viewer.call<{
      items: {
        kind: string;
        path: string | null;
        before: unknown;
        after: unknown;
        userId: string;
        at: string;
      }[];
    }>(`/v1/orgs/${a.org}/cases/${a.completed}/review-events`);
    expect(res.status).toBe(200);
    expect(
      res.body.items.map((e) => [e.kind, e.path, e.before, e.after]),
    ).toEqual([
      ["field.edited", "total", 12, 120],
      ["completed", null, null, null],
    ]);
  });

  it("are hidden from members without access and from other organizations", async () => {
    expect(
      (
        await outsider.call(
          `/v1/orgs/${a.org}/cases/${a.completed}/review-events`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await otherOwner.call(
          `/v1/orgs/${b.org}/cases/${a.completed}/review-events`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await otherOwner.call(
          `/v1/orgs/${a.org}/cases/${a.completed}/review-events`,
        )
      ).status,
    ).toBe(403);
  });
});

describe("capture export", () => {
  const exportPath = (s: Seeded, query = "") =>
    `/v1/orgs/${s.org}/agents/invoices/capture/export${query}`;

  it("streams every closed case with its capture and review events, skipping purged ones", async () => {
    const res = await callStream(owner, exportPath(a));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const all = lines(res.body);
    const trailer = all.pop()!;
    expect(trailer).toEqual({ next: null, skipped: 1 });
    expect(all.map((l) => l.case!.id)).toEqual([
      a.older,
      a.completed,
      a.failed,
      a.cancelled,
    ]);
    const completed = all[1]!;
    expect(completed.case).toMatchObject({
      status: "completed",
      model: "kimi-k3.1-pro",
    });
    expect(completed.capture?.caseId).toBe(a.completed);
    expect(completed.reviewEvents?.map((e) => e.kind)).toEqual([
      "field.edited",
      "completed",
    ]);
    expect(all[3]!.capture).toBeNull();
  });

  it("pages with a cursor and filters by time and status", async () => {
    const first = lines(
      (await callStream(developer, exportPath(a, "?limit=2"))).body,
    );
    expect(first.slice(0, 2).map((l) => l.case!.id)).toEqual([
      a.older,
      a.completed,
    ]);
    const next = first.at(-1)!.next!;
    expect(next).toBeTruthy();
    const second = lines(
      (
        await callStream(
          developer,
          exportPath(a, `?limit=2&cursor=${encodeURIComponent(next)}`),
        )
      ).body,
    );
    expect(second.slice(0, -1).map((l) => l.case!.id)).toEqual([
      a.failed,
      a.cancelled,
    ]);
    expect(second.at(-1)?.skipped).toBe(0);
    expect(second.at(-1)?.next).toBeTruthy();
    const third = lines(
      (
        await callStream(
          developer,
          exportPath(
            a,
            `?limit=2&cursor=${encodeURIComponent(second.at(-1)!.next!)}`,
          ),
        )
      ).body,
    );
    expect(third).toEqual([{ next: null, skipped: 1 }]);

    const from = encodeURIComponent(ago(10).toISOString());
    const filtered = lines(
      (
        await callStream(
          keyed,
          exportPath(a, `?from=${from}&status=completed,failed`),
        )
      ).body,
    );
    expect(filtered.slice(0, -1).map((l) => l.case!.id)).toEqual([
      a.completed,
      a.failed,
    ]);

    expect(
      (await callStream(owner, exportPath(a, "?cursor=nope"))).status,
    ).toBe(400);
    expect(
      (await callStream(owner, exportPath(a, "?status=running"))).status,
    ).toBe(400);
    expect((await callStream(owner, exportPath(a, "?limit=501"))).status).toBe(
      400,
    );
  });

  it("is for Developers, Admins, Owners and API keys only", async () => {
    expect((await callStream(viewer, exportPath(a))).status).toBe(403);
    expect((await callStream(outsider, exportPath(a))).status).toBe(403);
    expect((await callStream(keyed, exportPath(a))).status).toBe(200);
  });

  it("has a count of every page's lines and skipped cases, for the same people", async () => {
    const countPath = (s: Seeded, query = "") =>
      `/v1/orgs/${s.org}/agents/invoices/capture/count${query}`;
    const total = await developer.call<{ count: number }>(countPath(a));
    expect(total.body).toEqual({ count: 5 });
    const from = encodeURIComponent(ago(10).toISOString());
    expect(
      (
        await keyed.call<{ count: number }>(
          countPath(a, `?from=${from}&status=completed,failed`),
        )
      ).body,
    ).toEqual({ count: 3 });
    expect((await viewer.call(countPath(a))).status).toBe(403);
    expect((await otherOwner.call(countPath(a))).status).toBe(403);
  });

  it("is recorded as capture.exported", async () => {
    const audit = await owner.call<{
      events: {
        action: string;
        targetId: string;
        data: { count: number; skipped: number; filters: { status: string[] } };
      }[];
    }>(`/v1/orgs/${a.org}/audit-events?action=capture.exported`);
    expect(audit.body.events.length).toBeGreaterThanOrEqual(4);
    expect(audit.body.events.map((e) => e.data.count)).toContain(4);
    expect(audit.body.events.every((e) => e.targetId === a.agentId)).toBe(true);
  });

  it("never reaches another organization's cases", async () => {
    expect((await callStream(otherOwner, exportPath(a))).status).toBe(403);
    const own = lines((await callStream(otherOwner, exportPath(b))).body);
    expect(own.slice(0, -1).map((l) => l.case!.id)).toEqual([
      b.older,
      b.completed,
      b.failed,
      b.cancelled,
    ]);
    expect(
      read
        .filter((k) => k.organizationId === b.org)
        .every((k) => k.agentId === b.agentId),
    ).toBe(true);
    expect(
      read
        .filter((k) => k.organizationId === a.org)
        .every((k) => k.agentId === a.agentId),
    ).toBe(true);
    expect(
      (
        await callStream(
          otherOwner,
          `/v1/orgs/${b.org}/agents/${a.agentId}/capture/export`,
        )
      ).status,
    ).toBe(404);
  });
});

describe("the runtime's readCapture", () => {
  it("answers null for a case with no stored capture", async () => {
    const real = (env as unknown as { RUNTIME: Runtime }).RUNTIME;
    expect(
      await real.readCapture({
        organizationId: a.org,
        agentId: a.agentId,
        caseId: newId("case"),
      }),
    ).toBeNull();
  });
});
