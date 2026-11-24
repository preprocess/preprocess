// Run logs (design doc 09): the queue consumer stores records and keeps the
// Postgres summaries; who may read a case's logs and the logs across cases;
// filters; and that one organization never reads another's records.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { logSummaries } from "@preprocess/db/schema/logs";
import { logId, type LogRecord } from "@preprocess/logs";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { ingestLogs, logSql, r2Store } from "../src/logs.ts";
import type { Client } from "./helpers.ts";
import {
  addMember,
  createOrganization,
  logged,
  signUp,
  testEnv,
} from "./helpers.ts";

const environment = testEnv();

type Page = {
  logs: Array<Pick<LogRecord, "id" | "kind" | "level" | "message" | "caseId">>;
  cursor: string | null;
  summary: {
    events: number;
    errors: number;
    warnings: number;
    lastError: { message: string } | null;
  } | null;
};

const seed = async (client: Client, name: string) => {
  const org = await createOrganization(client, name);
  const agentId = newId("agent");
  const deploymentId = newId("deployment");
  const caseId = newId("case");
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
      createdBy: "seed",
      promotedAt: new Date(),
    });
    await tx.insert(cases).values({
      id: caseId,
      organizationId: org,
      agentId,
      deploymentId,
      status: "completed",
      source: "api",
    });
  });
  return { org, agentId, deploymentId, caseId };
};

const record = (
  scope: { org: string; agentId: string; deploymentId: string; caseId: string },
  fields: Partial<LogRecord> & Pick<LogRecord, "kind" | "level" | "message">,
  at = Date.now(),
): LogRecord => ({
  id: logId(at),
  at: new Date(at).toISOString(),
  organizationId: scope.org,
  agentId: scope.agentId,
  deploymentId: scope.deploymentId,
  caseId: scope.caseId,
  source: "platform",
  durationMs: null,
  traceId: null,
  spanId: null,
  error: null,
  data: "{}",
  ...fields,
});

let owner: Client;
let member: Client;
let other: Client;
let a: Awaited<ReturnType<typeof seed>>;
let b: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  owner = (await signUp("Lou", environment)).client;
  a = await seed(owner, "Acme");
  member = (await addMember(owner, a.org, "Max")).client;
  other = (await signUp("Bea", environment)).client;
  b = await seed(other, "Globex");
  const now = Date.now();
  await ingestLogs(environment, [
    record(
      a,
      { kind: "case.started", level: "info", message: "Case started" },
      now - 3000,
    ),
    record(
      a,
      {
        kind: "tool.call",
        level: "warn",
        message: "lookup failed",
        error: { message: "timeout" },
      },
      now - 2000,
    ),
    record(
      a,
      {
        kind: "model.call",
        level: "error",
        message: "Model call 2 failed",
        error: { message: "upstream 503" },
      },
      now - 1000,
    ),
    record(
      b,
      { kind: "case.started", level: "info", message: "Globex secret case" },
      now - 500,
    ),
  ]);
});

describe("ingesting run logs", () => {
  it("keeps per-case and per-deployment summaries in Postgres", async () => {
    const rows = await withOrg(environment, orgId(a.org), (tx) =>
      tx
        .select()
        .from(logSummaries)
        .where(eq(logSummaries.organizationId, a.org)),
    );
    expect(
      rows
        .map((r) => [
          r.subjectKind,
          r.subjectId,
          r.events,
          r.errors,
          r.warnings,
        ])
        .sort(),
    ).toEqual([
      ["case", a.caseId, 3, 1, 1],
      ["deployment", a.deploymentId, 3, 1, 1],
    ]);
    expect(rows[0]!.lastError).toMatchObject({
      kind: "model.call",
      message: "upstream 503",
    });
  });

  it("adds to the summaries as more records arrive", async () => {
    await ingestLogs(environment, [
      record(a, { kind: "case.run", level: "info", message: "Case completed" }),
    ]);
    const res = await owner.call<Page>(
      "/v1/orgs/" + a.org + "/cases/" + a.caseId + "/logs",
    );
    expect(res.body.summary).toMatchObject({
      events: 4,
      errors: 1,
      warnings: 1,
    });
    expect(res.body.summary?.lastError?.message).toBe("upstream 503");
  });
});

describe("reading run logs", () => {
  it("returns a case's logs newest first to someone who can see the case", async () => {
    const res = await owner.call<Page>(
      "/v1/orgs/" + a.org + "/cases/" + a.caseId + "/logs",
    );
    expect(res.status).toBe(200);
    expect(res.body.logs.map((l) => l.kind)).toEqual([
      "case.run",
      "model.call",
      "tool.call",
      "case.started",
    ]);
  });

  it("hides a case from a member without access to its agent", async () => {
    const res = await member.call(
      "/v1/orgs/" + a.org + "/cases/" + a.caseId + "/logs",
    );
    expect(res.status).toBe(404);
  });

  it("keeps logs across cases to Owners, Admins and Developers", async () => {
    expect((await member.call("/v1/orgs/" + a.org + "/logs")).status).toBe(403);
    expect(
      (await member.call("/v1/orgs/" + a.org + "/logs?agent=" + a.agentId))
        .status,
    ).toBe(403);
    const res = await owner.call<Page>(
      "/v1/orgs/" + a.org + "/logs?agent=" + a.agentId,
    );
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(4);
  });

  it("filters by level and text and pages with a cursor", async () => {
    const errors = await owner.call<Page>(
      "/v1/orgs/" + a.org + "/logs?level=error",
    );
    expect(errors.body.logs.map((l) => l.message)).toEqual([
      "Model call 2 failed",
    ]);
    const found = await owner.call<Page>(
      "/v1/orgs/" + a.org + "/logs?search=TIMEOUT",
    );
    expect(found.body.logs.map((l) => l.kind)).toEqual(["tool.call"]);
    const first = await owner.call<Page>("/v1/orgs/" + a.org + "/logs?limit=3");
    expect(first.body.logs).toHaveLength(3);
    const next = await owner.call<Page>(
      "/v1/orgs/" + a.org + "/logs?limit=3&cursor=" + first.body.cursor,
    );
    expect(next.body.logs.map((l) => l.kind)).toEqual(["case.started"]);
    expect(next.body.cursor).toBeNull();
  });

  it("never returns another organization's records", async () => {
    const res = await owner.call<Page>(
      "/v1/orgs/" + a.org + "/logs?search=Globex",
    );
    expect(res.body.logs).toEqual([]);
    const theirs = await owner.call("/v1/orgs/" + b.org + "/logs");
    expect(theirs.status).toBe(403);
    const forged = await owner.call<Page>(
      "/v1/orgs/" + a.org + "/logs?case=" + b.caseId,
    );
    expect(forged.body.logs).toEqual([]);
  });
});

describe("the API's own wide events", () => {
  it("queues one record per request once the caller belongs to the organization", async () => {
    logged.length = 0;
    await owner.call("/v1/orgs/" + a.org + "/logs?level=warn");
    await owner.call("/v1/orgs/" + b.org + "/logs");
    const requests = logged.filter((r) => r.kind === "request");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      organizationId: a.org,
      source: "platform",
      message: "GET /v1/orgs/" + a.org + "/logs 200",
    });
  });
});

describe("the R2 SQL query", () => {
  it("always scopes to the organization and quotes every value", () => {
    const query = logSql({
      organizationId: "org_a",
      caseId: "x' OR '1'='1",
      search: "o'brien",
      limit: 50,
      from: "2026-11-20T00:00:00.000Z",
      to: "2026-11-24T00:00:00.000Z",
    });
    expect(query).toContain("\"organizationId\" = 'org_a'");
    expect(query).toContain("\"caseId\" = 'x'' OR ''1''=''1'");
    expect(query).toContain("LIKE '%o''brien%'");
    expect(query).toMatch(/ORDER BY "id" DESC LIMIT 51$/);
  });
});

describe("the local store", () => {
  it("finds a case's records without the agent id", async () => {
    const store = r2Store(env.LOG_BUCKET);
    const page = await store.query({
      organizationId: a.org,
      caseId: a.caseId,
      limit: 10,
    });
    expect(page.records.length).toBeGreaterThan(0);
    expect(page.records.every((r) => r.caseId === a.caseId)).toBe(true);
  });
});
