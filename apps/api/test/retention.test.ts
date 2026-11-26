// Retention controls (spec 16a): keep-forever defaults, who may change a
// period, the daily sweep across files, run capture, run logs and whole
// cases with the memory rules people deleted, one retention.purged event per
// kind, an audit chain that still
// verifies, the Owner-only manual delete, and one organization's sweep never
// reaching another's rows or R2 keys.

import { verifyAuditChain } from "@preprocess/db/audit";
import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import {
  caseApprovals,
  cases,
  files,
  reviewEvents,
} from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { logSummaries } from "@preprocess/db/schema/logs";
import { agentMemories } from "@preprocess/db/schema/memories";
import { retentionSweeps } from "@preprocess/db/schema/retention";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { Env, Runtime } from "../src/env.ts";
import { sweepRetention } from "../src/retention.ts";
import type { Client } from "./helpers.ts";
import {
  addMember,
  Client as ApiClient,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

type Key = { organizationId: string; agentId: string; caseId: string };
const keyOf = (k: Key) => `${k.organizationId}/${k.agentId}/${k.caseId}`;

// The runtime's case objects and run captures, as far as retention sees them.
const captures = new Set<string>();
const wiped: string[] = [];
const runtime = {
  deleteCapture: (k: Key) => {
    captures.delete(keyOf(k));
    return Promise.resolve();
  },
  deleteCase: (k: Key) => {
    captures.delete(keyOf(k));
    wiped.push(keyOf(k));
    return Promise.resolve();
  },
} as unknown as Runtime;

const environment: Env = testEnv({ RUNTIME: runtime });

type Retention = {
  documentsDays: number | null;
  runCaptureDays: number | null;
  runLogsDays: number | null;
  casesDays: number | null;
  updatedAt: string | null;
  error?: { code: string; message: string };
};
type AuditEvent = {
  action: string;
  actorId: string;
  caseId: string | null;
  data: Record<string, unknown>;
};

let owner: Client;
let ownerId: string;
let admin: Client;
let adminId: string;
let member: Client;
let keyed: Client;
let otherOwner: Client;

// The cases each organization starts with, by role in the test.
type Seeded = {
  org: string;
  agentId: string;
  ancient: string; // closed 60 days ago
  old: string; // completed 40 days ago
  cancelled: string; // cancelled 40 days ago
  recent: string; // completed 2 days ago
  running: string; // rerun of a case that completed 40 days ago
  waiting: string; // open since 60 days ago
  rules: Record<Rule, string>;
};

// Memory rules by where they were proposed and what became of them.
type Rule =
  | "ancientAccepted"
  | "ancientDismissed"
  | "ancientDeleted" // deleted a day ago
  | "recentAccepted"
  | "recentStale" // deleted 55 days ago
  | "recentFresh"; // deleted 2 days ago
let a: Seeded;
let b: Seeded;

const fileKeys = new Map<string, string>();

const seed = async (org: string, userId: string): Promise<Seeded> => {
  const agentId = newId("agent");
  const deploymentId = newId("deployment");
  const s: Seeded = {
    org,
    agentId,
    ancient: newId("case"),
    old: newId("case"),
    cancelled: newId("case"),
    recent: newId("case"),
    running: newId("case"),
    waiting: newId("case"),
    rules: {
      ancientAccepted: newId("memory"),
      ancientDismissed: newId("memory"),
      ancientDeleted: newId("memory"),
      recentAccepted: newId("memory"),
      recentStale: newId("memory"),
      recentFresh: newId("memory"),
    },
  };
  const all = [s.ancient, s.old, s.cancelled, s.recent, s.running, s.waiting];
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
        id: s.ancient,
        status: "completed",
        createdAt: ago(61),
        updatedAt: ago(60),
        completedAt: ago(60),
      },
      {
        ...base,
        id: s.old,
        status: "completed",
        createdAt: ago(41),
        updatedAt: ago(40),
        completedAt: ago(40),
      },
      {
        ...base,
        id: s.cancelled,
        status: "cancelled",
        createdAt: ago(41),
        updatedAt: ago(40),
      },
      {
        ...base,
        id: s.recent,
        status: "completed",
        createdAt: ago(3),
        updatedAt: ago(2),
        completedAt: ago(2),
      },
      {
        ...base,
        id: s.running,
        status: "running",
        createdAt: ago(41),
        updatedAt: ago(40),
        completedAt: ago(40),
      },
      {
        ...base,
        id: s.waiting,
        status: "waiting",
        createdAt: ago(61),
        updatedAt: ago(60),
      },
    ]);
    const rule = (
      name: Rule,
      caseId: string,
      status: "accepted" | "dismissed" | "deleted",
      deletedDaysAgo?: number,
    ) => ({
      id: s.rules[name],
      organizationId: org,
      agentId,
      caseId,
      text: `Rule ${name}`,
      status,
      ...(deletedDaysAgo !== undefined && {
        deletedBy: userId,
        deletedAt: ago(deletedDaysAgo),
      }),
    });
    await tx
      .insert(agentMemories)
      .values([
        rule("ancientAccepted", s.ancient, "accepted"),
        rule("ancientDismissed", s.ancient, "dismissed"),
        rule("ancientDeleted", s.ancient, "deleted", 1),
        rule("recentAccepted", s.recent, "accepted"),
        rule("recentStale", s.recent, "deleted", 55),
        rule("recentFresh", s.recent, "deleted", 2),
      ]);
    for (const caseId of all) {
      const fileId = newId("file");
      const r2Key = `${org}/files/${fileId}`;
      fileKeys.set(caseId, r2Key);
      await environment.FILES.put(r2Key, "invoice");
      await tx.insert(files).values({
        id: fileId,
        organizationId: org,
        caseId,
        name: "invoice.pdf",
        contentType: "application/pdf",
        size: 7,
        sha256: new Uint8Array(32),
        r2Key,
        createdBy: userId,
      });
      await tx.insert(reviewEvents).values({
        id: newId("reviewEvent"),
        organizationId: org,
        caseId,
        userId,
        kind: "edit",
        path: "invoice.total",
        before: 1,
        after: 2,
      });
      await tx.insert(caseApprovals).values({
        id: `apr_${crypto.randomUUID()}`,
        organizationId: org,
        caseId,
        level: "completion",
        target: "",
        status: "approved",
        requestedAt: ago(61),
      });
      await tx.insert(logSummaries).values({
        organizationId: org,
        subjectKind: "case",
        subjectId: caseId,
        events: 3,
        firstAt: ago(61),
        lastAt: ago(40),
      });
      captures.add(keyOf({ organizationId: org, agentId, caseId }));
    }
  });
  // Run-log records in the local store (logs.ts), on the day each case began.
  for (const [caseId, days] of [
    [s.old, 41],
    [s.recent, 3],
  ] as const)
    await environment.LOG_BUCKET.put(
      `${org}/${ago(days).toISOString().slice(0, 10)}/${agentId}/${caseId}/log_1.ndjson`,
      "{}",
    );
  return s;
};

// What is left of each of a seeded organization's cases.
const state = async (s: Seeded) =>
  withOrg(environment, orgId(s.org), async (tx) => {
    const all = [s.ancient, s.old, s.cancelled, s.recent, s.running, s.waiting];
    const caseRows = await tx
      .select({ id: cases.id })
      .from(cases)
      .where(inArray(cases.id, all));
    const fileRows = await tx
      .select({ caseId: files.caseId })
      .from(files)
      .where(inArray(files.caseId, all));
    const reviewRows = await tx
      .select({ caseId: reviewEvents.caseId })
      .from(reviewEvents)
      .where(inArray(reviewEvents.caseId, all));
    const approvalRows = await tx
      .select({ caseId: caseApprovals.caseId })
      .from(caseApprovals)
      .where(inArray(caseApprovals.caseId, all));
    const summaryRows = await tx
      .select({ id: logSummaries.subjectId })
      .from(logSummaries)
      .where(inArray(logSummaries.subjectId, all));
    const objects = await Promise.all(
      all.map(
        async (id) =>
          [
            id,
            (await environment.FILES.head(fileKeys.get(id)!)) !== null,
          ] as const,
      ),
    );
    const has = (rows: { id?: string | null; caseId?: string | null }[]) =>
      new Set(rows.map((r) => r.id ?? r.caseId));
    return Object.fromEntries(
      all.map((id) => [
        id,
        {
          case: has(caseRows).has(id),
          file: has(fileRows).has(id),
          object: objects.find(([k]) => k === id)![1],
          reviews: has(reviewRows).has(id),
          approvals: has(approvalRows).has(id),
          summary: has(summaryRows).has(id),
          capture: captures.has(
            keyOf({ organizationId: s.org, agentId: s.agentId, caseId: id }),
          ),
        },
      ]),
    );
  });

// The memory rules of a seeded organization still stored, text and all.
const rulesLeft = async (s: Seeded) =>
  withOrg(environment, orgId(s.org), async (tx) => {
    const rows = await tx
      .select({ id: agentMemories.id, text: agentMemories.text })
      .from(agentMemories)
      .where(inArray(agentMemories.id, Object.values(s.rules)));
    return (Object.keys(s.rules) as Rule[])
      .filter((name) =>
        rows.some((r) => r.id === s.rules[name] && r.text === `Rule ${name}`),
      )
      .sort();
  });

const everything = {
  case: true,
  file: true,
  object: true,
  reviews: true,
  approvals: true,
  summary: true,
  capture: true,
};

const events = async (org: string, action: string) =>
  (
    await (org === a.org ? owner : otherOwner).call<{ events: AuditEvent[] }>(
      `/v1/orgs/${org}/audit-events?action=${action}`,
    )
  ).body.events;

const put = (client: Client, body: object) =>
  client.call<Retention>(`/v1/orgs/${a.org}/retention`, {
    method: "PUT",
    body,
  });

beforeAll(async () => {
  const ana = await signUp("Rita", environment);
  owner = ana.client;
  ownerId = ana.userId;
  const org = await createOrganization(owner, "Retainco");
  const adminMember = await addMember(owner, org, "Ada", "admin");
  admin = adminMember.client;
  adminId = adminMember.userId;
  member = (await addMember(owner, org, "Max")).client;
  const key = await owner.call<{ key: string }>("/api/auth/api-key/create", {
    body: { name: "ci", organizationId: org },
  });
  keyed = new ApiClient(environment, { "x-api-key": key.body.key });
  const other = await signUp("Otto", environment);
  otherOwner = other.client;
  const otherOrg = await createOrganization(otherOwner, "Keepco");
  a = await seed(org, ana.userId);
  b = await seed(otherOrg, other.userId);
});

describe("retention settings", () => {
  it("keep everything by default", async () => {
    const got = await member.call<Retention>(`/v1/orgs/${a.org}/retention`);
    expect(got.status).toBe(200);
    expect(got.body).toEqual({
      documentsDays: null,
      runCaptureDays: null,
      runLogsDays: null,
      casesDays: null,
      updatedAt: null,
    });
    await sweepRetention(environment);
    const after = await state(a);
    for (const id of Object.keys(after)) expect(after[id]).toEqual(everything);
    expect(await events(a.org, "retention.purged")).toEqual([]);
  });

  it("let only Owners shorten a period, let Admins lengthen one, and audit both", async () => {
    const refused = await put(admin, { runCaptureDays: 30 });
    expect(refused.status).toBe(403);
    expect(refused.body.error?.message).toBe(
      "Only Owners can shorten how long data is kept. Admins can lengthen it.",
    );
    expect((await put(keyed, { casesDays: 365 })).status).toBe(403);
    expect((await put(member, { casesDays: null })).status).toBe(403);
    const tooShort = await put(owner, { documentsDays: 3 });
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.error?.message).toBe(
      "documentsDays: A retention period is at least 7 days.",
    );

    const set = await put(owner, { documentsDays: 20, runCaptureDays: 30 });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({
      documentsDays: 20,
      runCaptureDays: 30,
      runLogsDays: null,
      casesDays: null,
    });
    // Lengthening, and back to keep forever, are an Admin's to make.
    expect((await put(admin, { documentsDays: 60 })).body.documentsDays).toBe(
      60,
    );
    expect(
      (await put(admin, { runCaptureDays: null })).body.runCaptureDays,
    ).toBe(null);
    expect((await put(admin, { documentsDays: 30 })).status).toBe(403);

    const audited = await events(a.org, "retention.updated");
    const keep = {
      cases: null,
      documents: null,
      runCapture: null,
      runLogs: null,
    };
    expect(audited.map((e) => [e.actorId, e.data])).toEqual([
      [
        ownerId,
        {
          before: keep,
          after: { ...keep, documents: 20, runCapture: 30 },
          shortened: ["documents", "runCapture"],
        },
      ],
      [
        adminId,
        {
          before: { ...keep, documents: 20, runCapture: 30 },
          after: { ...keep, documents: 60, runCapture: 30 },
          shortened: [],
        },
      ],
      [
        adminId,
        {
          before: { ...keep, documents: 60, runCapture: 30 },
          after: { ...keep, documents: 60 },
          shortened: [],
        },
      ],
    ]);

    const final = await put(owner, {
      documentsDays: 30,
      runCaptureDays: 30,
      runLogsDays: 30,
      casesDays: 50,
    });
    expect(final.body).toMatchObject({
      documentsDays: 30,
      runCaptureDays: 30,
      runLogsDays: 30,
      casesDays: 50,
    });
    expect(final.body.updatedAt).not.toBeNull();
  });
});

describe("the daily sweep", () => {
  it("deletes only closed cases' data older than each period, and never open cases", async () => {
    await sweepRetention(environment);
    const after = await state(a);
    const stripped = {
      ...everything,
      file: false,
      object: false,
      summary: false,
      capture: false,
    };
    // Past the 50-day case period: the whole case and everything it holds.
    expect(after[a.ancient]).toEqual({
      case: false,
      file: false,
      object: false,
      reviews: false,
      approvals: false,
      summary: false,
      capture: false,
    });
    expect(wiped).toContain(
      keyOf({ organizationId: a.org, agentId: a.agentId, caseId: a.ancient }),
    );
    // Past 30 days: documents, capture and logs, but the case and its review
    // events stay.
    expect(after[a.old]).toEqual(stripped);
    expect(after[a.cancelled]).toEqual(stripped);
    const logs = await environment.LOG_BUCKET.list({ prefix: `${a.org}/` });
    expect(logs.objects.map((o) => o.key.split("/")[3])).toEqual([a.recent]);
    // Closed too recently, or open however old.
    expect(after[a.recent]).toEqual(everything);
    expect(after[a.running]).toEqual(everything);
    expect(after[a.waiting]).toEqual(everything);
  });

  it("purges deleted memory rules under the cases period, and every rule but accepted ones with their case", async () => {
    // The ancient case took its dismissed and deleted rules with it; a rule
    // deleted 55 days ago went with the 50-day period though its case stays;
    // accepted rules and one deleted two days ago are kept.
    expect(await rulesLeft(a)).toEqual([
      "ancientAccepted",
      "recentAccepted",
      "recentFresh",
    ]);
  });

  it("writes one retention.purged event per kind, with the cutoff and counts", async () => {
    const purged = await events(a.org, "retention.purged");
    expect(purged).toHaveLength(4);
    const byKind: Record<string, AuditEvent> = Object.fromEntries(
      purged.map((e) => [String(e.data.kind), e]),
    );
    expect(Object.keys(byKind).sort()).toEqual([
      "cases",
      "documents",
      "runCapture",
      "runLogs",
    ]);
    expect(byKind.cases!.data).toMatchObject({
      days: 50,
      counts: {
        cases: 1,
        files: 1,
        summaries: 1,
        logObjects: 0,
        memories: 3,
      },
    });
    expect(byKind.documents!.data).toMatchObject({
      days: 30,
      counts: { files: 2, bytes: 14 },
    });
    expect(byKind.runCapture!.data).toMatchObject({
      days: 30,
      counts: { cases: 2 },
    });
    expect(byKind.runLogs!.data).toMatchObject({
      days: 30,
      counts: { cases: 2, summaries: 2, logObjects: 1 },
    });
    for (const e of purged) {
      expect(e.actorId).toBe("retention");
      expect(Date.parse(e.data.cutoff as string)).toBeLessThan(
        ago(29).getTime(),
      );
    }
  });

  it("is safe to rerun, and audits a sweep that stopped before its event", async () => {
    await sweepRetention(environment);
    expect(await events(a.org, "retention.purged")).toHaveLength(4);
    // A sweep that timed out after a committed batch left its row open.
    await withOrg(environment, orgId(a.org), (tx) =>
      tx.insert(retentionSweeps).values({
        id: newId("retentionSweep"),
        organizationId: a.org,
        kind: "documents",
        days: 30,
        cutoff: ago(30),
        counts: { files: 3, bytes: 21 },
      }),
    );
    await sweepRetention(environment);
    const purged = await events(a.org, "retention.purged");
    expect(purged).toHaveLength(5);
    expect(purged.at(-1)!.data).toMatchObject({
      kind: "documents",
      counts: { files: 3, bytes: 21 },
    });
  });

  it("leaves the audit chain verifiable", async () => {
    const result = await withOrg(environment, orgId(a.org), (tx) =>
      verifyAuditChain(tx, a.org),
    );
    expect(result.ok).toBe(true);
    // The same check the API offers, which also matches signed daily copies.
    const verify = await owner.call<{ ok: boolean }>(
      `/v1/orgs/${a.org}/audit-events/verify`,
      { method: "POST" },
    );
    expect(verify.body.ok).toBe(true);
  });

  it("never touches another organization's rows or R2 keys", async () => {
    const other = await state(b);
    for (const id of Object.keys(other)) expect(other[id]).toEqual(everything);
    expect(await rulesLeft(b)).toEqual(Object.keys(b.rules).sort());
    expect(await events(b.org, "retention.purged")).toEqual([]);
    expect(
      (await environment.LOG_BUCKET.list({ prefix: `${b.org}/` })).objects,
    ).toHaveLength(2);
    // A row in one organization naming another's R2 key is refused, not
    // followed.
    const foreign = fileKeys.get(b.recent)!;
    await withOrg(environment, orgId(a.org), (tx) =>
      tx.insert(files).values({
        id: newId("file"),
        organizationId: a.org,
        caseId: a.old,
        name: "elsewhere.pdf",
        contentType: "application/pdf",
        size: 7,
        sha256: new Uint8Array(32),
        r2Key: foreign,
        createdBy: ownerId,
      }),
    );
    await sweepRetention(environment);
    expect(await environment.FILES.head(foreign)).not.toBeNull();
  });
});

describe("deleting a case by hand", () => {
  it("is for Owners only", async () => {
    for (const client of [admin, member, keyed]) {
      const refused = await client.call<{ error: { message: string } }>(
        `/v1/orgs/${a.org}/cases/${a.recent}`,
        { method: "DELETE" },
      );
      expect(refused.status).toBe(403);
      expect(refused.body.error.message).toBe("Only Owners can delete a case.");
    }
    expect((await state(a))[a.recent]).toEqual(everything);
  });

  it("refuses an open case and another organization's", async () => {
    const open = await owner.call<{ error: { code: string; message: string } }>(
      `/v1/orgs/${a.org}/cases/${a.waiting}`,
      { method: "DELETE" },
    );
    expect(open.status).toBe(409);
    expect(open.body.error).toEqual({
      code: "case_open",
      message:
        "Only a completed, failed or cancelled case can be deleted. Cancel it first.",
    });
    const foreign = await owner.call(`/v1/orgs/${a.org}/cases/${b.recent}`, {
      method: "DELETE",
    });
    expect(foreign.status).toBe(404);
    expect((await state(b))[b.recent]).toEqual(everything);
  });

  it("deletes the case and everything it holds, and audits ids only", async () => {
    const deleted = await owner.call(`/v1/orgs/${a.org}/cases/${a.recent}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect((await state(a))[a.recent]).toEqual({
      case: false,
      file: false,
      object: false,
      reviews: false,
      approvals: false,
      summary: false,
      capture: false,
    });
    expect(await rulesLeft(a)).toEqual(["ancientAccepted", "recentAccepted"]);
    const audited = await events(a.org, "case.deleted");
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({ actorId: ownerId, caseId: a.recent });
    expect(Object.keys(audited[0]!.data).sort()).toEqual([
      "agentId",
      "deploymentId",
    ]);
    expect(audited[0]!.data.agentId).toBe(a.agentId);
    expect(
      (
        await owner.call(`/v1/orgs/${a.org}/cases/${a.recent}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    const result = await withOrg(environment, orgId(a.org), (tx) =>
      verifyAuditChain(tx, a.org),
    );
    expect(result.ok).toBe(true);
    await withOrg(environment, orgId(a.org), async (tx) => {
      expect(
        await tx.select().from(cases).where(eq(cases.id, a.recent)),
      ).toEqual([]);
    });
  });
});
