// Cases through the HTTP API (design doc 04): the 202 create with
// Idempotency-Key, who may start and see a case, the queue start, the
// runtime's reports to the case index, and the case room's review events.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import {
  agentGrants,
  agents,
  groupMembers,
  groups,
} from "@preprocess/db/schema/access";
import {
  caseMentions,
  cases,
  outbox,
  reviewEvents,
} from "@preprocess/db/schema/cases";
import { auditEvents } from "@preprocess/db/schema/audit";
import { deployments } from "@preprocess/db/schema/deployments";
import { and, asc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { recordCaseEvent, startQueuedCase } from "../src/cases.ts";
import type { Env, Runtime, StartCase, WriteResult } from "../src/env.ts";
import type { OutboxMessage } from "../src/outbox.ts";
import { sweepOutbox } from "../src/outbox.ts";
import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";
import modelStub from "../../model-stub/src/index.ts";
import worker from "../src/index.ts";
// The stub's sample invoice page, as a data URL.
import acmeInvoice from "../../model-stub/fixtures/ocr/samples/acme-invoice.png?inline";

const queued: OutboxMessage[] = [];
let queueDown = false;
const started: StartCase[] = [];
const calls: { method: string; input: Record<string, unknown> }[] = [];
let nextWrite: WriteResult = {
  result: "ok",
  path: "vendor",
  before: "acme",
  after: "globex",
  stale: ["currency"],
};

let roomState: Awaited<ReturnType<Runtime["caseState"]>> = {
  status: "completed",
  run: 1,
  answers: { vendor: "globex" },
  checks: [],
};

let completion: Awaited<ReturnType<Runtime["completeCase"]>> = {
  result: "refused",
  code: "case_not_done",
  message: "Checks failing: amountPositive",
};

const runtime: Runtime = {
  manifest: () => Promise.reject(new Error("unused")),
  getCase: () => Promise.reject(new Error("unused")),
  putBundle: () => Promise.reject(new Error("unused")),
  queueSandboxLayer: () => Promise.reject(new Error("unused")),
  deleteSandboxLayer: () => Promise.reject(new Error("unused")),
  startCase: (start) => {
    started.push(start);
    return Promise.resolve({});
  },
  caseState: () => Promise.resolve(roomState),
  rerun: (input) => {
    calls.push({ method: "rerun", input });
    return Promise.resolve({
      status: "running",
      run: 2,
      answers: null,
      checks: [],
    });
  },
  editAnswer: (input) => {
    calls.push({ method: "edit", input });
    return Promise.resolve({
      result: nextWrite,
      checks: [{ name: "amountPositive", ok: true }],
    });
  },
  confirmAnswer: () => Promise.reject(new Error("unused")),
  acceptSuggestion: () => Promise.reject(new Error("unused")),
  searchOptions: () => Promise.resolve({ items: [] }),
  postMessage: () => Promise.resolve({ id: "m1", mentioned: [] }),
  decideApproval: (input) => {
    calls.push({ method: "decide", input });
    return Promise.resolve(roomState);
  },
  completeCase: (input) => {
    calls.push({ method: "complete", input });
    return Promise.resolve(completion);
  },
  readCapture: () => Promise.reject(new Error("unused")),
  deleteCapture: () => Promise.reject(new Error("unused")),
  deleteCase: () => Promise.reject(new Error("unused")),
  deleteOrganizationObjects: () => Promise.reject(new Error("unused")),
  cancelCase: (input) => {
    calls.push({ method: "cancel", input });
    return Promise.resolve({
      status: "cancelled",
      run: 1,
      answers: null,
      checks: [],
    });
  },
};

const environment: Env = testEnv({
  RUNTIME: runtime,
  CASES: {
    send: (message: OutboxMessage) => {
      if (queueDown) return Promise.reject(new Error("queue unavailable"));
      queued.push(message);
      return Promise.resolve();
    },
  } as unknown as Queue<OutboxMessage>,
});

let owner: Client;
let ownerId: string;
let operator: Client;
let operatorId: string;
let outsider: Client;
let admin: Client;
let org: string;
const agentId = newId("agent");
const unpromotedAgent = newId("agent");
const deploymentId = newId("deployment");
const apGroup = newId("group");

beforeAll(async () => {
  const ana = await signUp("Ana", environment);
  owner = ana.client;
  ownerId = ana.userId;
  org = await createOrganization(owner, "Acme");
  const op = await addMember(owner, org, "Omar");
  operator = op.client;
  operatorId = op.userId;
  outsider = (await addMember(owner, org, "Mia")).client;
  admin = (await addMember(owner, org, "Ada", "admin")).client;
  await withOrg(environment, orgId(org), async (tx) => {
    await tx.insert(agents).values([
      { id: agentId, organizationId: org, slug: "invoices" },
      { id: unpromotedAgent, organizationId: org, slug: "drafts" },
    ]);
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
    await tx.insert(groups).values({
      id: apGroup,
      organizationId: org,
      slug: "accounts-payable",
      name: "Accounts payable",
    });
    await tx
      .insert(groupMembers)
      .values({ organizationId: org, groupId: apGroup, userId: op.userId });
    await tx.insert(agentGrants).values({
      organizationId: org,
      agentId,
      groupId: apGroup,
      access: "operator",
      grantedBy: ana.userId,
    });
  });
});

type Accepted = { id: string; status: string; statusUrl: string };
type CaseBody = {
  status: string;
  waitingOn: { slug: string } | null;
  answers: unknown;
};

describe("starting a case", () => {
  it("returns 202 with a status URL and replays a repeated Idempotency-Key", async () => {
    const keyed = new Client(environment, {
      "idempotency-key": "invoice-1042",
    });
    keyed.cookie = operator.cookie;
    const first = await keyed.call<Accepted>(`/v1/orgs/${org}/cases`, {
      body: { agent: "invoices", text: "Invoice 1042 from Acme" },
    });
    expect(first.status).toBe(202);
    expect(first.body.status).toBe("queued");
    expect(first.headers.get("location")).toBe(first.body.statusUrl);
    expect(queued.at(-1)).toMatchObject({
      organizationId: org,
      kind: "case.start",
    });

    const again = await keyed.call<Accepted>(`/v1/orgs/${org}/cases`, {
      body: { agent: "invoices", text: "Invoice 1042 from Acme" },
    });
    expect(again.status).toBe(202);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.body.id).toBe(first.body.id);

    const changed = await keyed.call<{ error: { code: string } }>(
      `/v1/orgs/${org}/cases`,
      {
        body: { agent: "invoices", text: "Invoice 1043" },
      },
    );
    expect(changed.status).toBe(422);
    expect(changed.body.error.code).toBe("idempotency_mismatch");

    const rows = await withOrg(environment, orgId(org), (tx) =>
      tx.select().from(cases).where(eq(cases.agentId, agentId)),
    );
    expect(rows.filter((r) => r.id === first.body.id)).toHaveLength(1);
    expect(rows.find((r) => r.id === first.body.id)?.source).toBe("app");
  });

  it("refuses bad bodies, unknown agents and agents never promoted", async () => {
    const empty = await operator.call<{ error: { code: string } }>(
      `/v1/orgs/${org}/cases`,
      {
        body: { agent: "invoices" },
      },
    );
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe("invalid_request");
    const unknown = await owner.call(`/v1/orgs/${org}/cases`, {
      body: { agent: "nobody", text: "x" },
    });
    expect(unknown.status).toBe(404);

    // Owners see every agent; one in Developers may start on any.
    await withOrg(environment, orgId(org), async (tx) => {
      const [dev] = await tx
        .select()
        .from(groups)
        .where(eq(groups.isDevelopers, true));
      await tx
        .insert(groupMembers)
        .values({ organizationId: org, groupId: dev!.id, userId: ownerId });
    });
    const unpromoted = await owner.call<{ error: { code: string } }>(
      `/v1/orgs/${org}/cases`,
      {
        body: { agent: "drafts", text: "x" },
      },
    );
    expect(unpromoted.status).toBe(409);
    expect(unpromoted.body.error.code).toBe("no_production_deployment");
  });

  it("needs operator access to start, and access to the agent to see", async () => {
    const refused = await outsider.call(`/v1/orgs/${org}/cases`, {
      body: { agent: "invoices", text: "x" },
    });
    expect(refused.status).toBe(404);
    const created = await operator.call<Accepted>(`/v1/orgs/${org}/cases`, {
      body: { agent: "invoices", text: "x" },
    });
    expect(
      (await outsider.call(`/v1/orgs/${org}/cases/${created.body.id}`)).status,
    ).toBe(404);
    expect(
      (await owner.call(`/v1/orgs/${org}/cases/${created.body.id}`)).status,
    ).toBe(200);
    const mine = await signUp("Pat", environment);
    const theirOrg = await createOrganization(mine.client, "Elsewhere");
    expect(
      (await mine.client.call(`/v1/orgs/${theirOrg}/cases/${created.body.id}`))
        .status,
    ).toBe(404);
    expect(
      (await mine.client.call(`/v1/orgs/${org}/cases/${created.body.id}`))
        .status,
    ).toBe(403);
  });
});

describe("a started case", () => {
  it("starts from the queue, is indexed from the runtime's reports, and records what people do", async () => {
    const created = await operator.call<Accepted>(`/v1/orgs/${org}/cases`, {
      body: { agent: "invoices", text: "Invoice 2001 from Globex" },
    });
    const caseId = created.body.id;
    await startQueuedCase(environment, queued.at(-1)!);
    expect(started.at(-1)).toMatchObject({
      organizationId: org,
      agentId,
      caseId,
      deploymentId,
      input: { text: "Invoice 2001 from Globex", files: [] },
    });
    expect(
      started
        .at(-1)
        ?.groups?.map((g) => [g.slug, g.access])
        .sort(),
    ).toEqual([
      ["accounts-payable", "operator"],
      ["developers", "developers"],
    ]);

    const key = { organizationId: org, agentId, caseId };
    await recordCaseEvent(environment, {
      ...key,
      type: "status",
      status: "running",
      waitingOn: null,
      reason: null,
      answers: null,
      error: null,
    });
    await recordCaseEvent(environment, {
      ...key,
      type: "mention",
      group: "accounts-payable",
      messageId: "m1",
      by: "agent",
      message: "Please check the vendor.",
    });
    await recordCaseEvent(environment, {
      ...key,
      type: "status",
      status: "waiting",
      waitingOn: "accounts-payable",
      reason: "Vendor needs a check",
      answers: null,
      error: null,
    });
    const waiting = await operator.call<CaseBody>(
      `/v1/orgs/${org}/cases/${caseId}`,
    );
    expect(waiting.body.status).toBe("waiting");
    expect(waiting.body.waitingOn?.slug).toBe("accounts-payable");
    const mentions = await withOrg(environment, orgId(org), (tx) =>
      tx.select().from(caseMentions).where(eq(caseMentions.caseId, caseId)),
    );
    expect(mentions).toMatchObject([
      { groupId: apGroup, message: "Please check the vendor." },
    ]);

    nextWrite = { result: "conflict", path: "vendor", version: 3 };
    const conflict = await operator.call<{ error: { code: string } }>(
      `/v1/orgs/${org}/cases/${caseId}/answers`,
      {
        method: "PATCH",
        body: { path: "vendor", value: "initech", version: 2 },
      },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("version_conflict");

    nextWrite = {
      result: "ok",
      path: "vendor",
      before: "acme",
      after: "globex",
      stale: ["currency"],
    };
    const edited = await operator.call(
      `/v1/orgs/${org}/cases/${caseId}/answers`,
      {
        method: "PATCH",
        body: { path: "vendor", value: "globex", version: 2 },
      },
    );
    expect(edited.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({
      method: "edit",
      input: { caseId, path: "vendor", value: "globex", version: 2 },
    });
    // Admins see every case; working one still needs an operator group.
    expect(
      (
        await admin.call(`/v1/orgs/${org}/cases/${caseId}/answers`, {
          method: "PATCH",
          body: { path: "vendor", value: "globex", version: 2 },
        })
      ).status,
    ).toBe(403);

    const rerun = await operator.call(`/v1/orgs/${org}/cases/${caseId}/rerun`, {
      body: {},
    });
    expect(rerun.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({
      method: "rerun",
      input: {
        notes: [
          {
            kind: "field.edited",
            path: "vendor",
            before: "acme",
            after: "globex",
          },
        ],
      },
    });
    // The next rerun only hears what changed since this one.
    await recordCaseEvent(environment, {
      ...key,
      type: "status",
      status: "completed",
      waitingOn: null,
      reason: null,
      answers: { vendor: "globex" },
      error: null,
    });
    await operator.call(`/v1/orgs/${org}/cases/${caseId}/rerun`, { body: {} });
    expect(calls.at(-1)).toMatchObject({
      method: "rerun",
      input: { notes: [] },
    });

    const events = await withOrg(environment, orgId(org), (tx) =>
      tx
        .select()
        .from(reviewEvents)
        .where(eq(reviewEvents.caseId, caseId))
        .orderBy(asc(reviewEvents.at)),
    );
    expect(events.map((e) => e.kind)).toEqual([
      "field.edited",
      "rerun",
      "rerun",
    ]);
    expect(events[0]).toMatchObject({
      path: "vendor",
      before: "acme",
      after: "globex",
      checks: [{ name: "amountPositive", ok: true }],
    });
  });

  it("is cancelled before it starts without reaching the runtime", async () => {
    const created = await operator.call<Accepted>(`/v1/orgs/${org}/cases`, {
      body: { agent: "invoices", text: "cancel me" },
    });
    const cancelled = await operator.call(
      `/v1/orgs/${org}/cases/${created.body.id}/cancel`,
      { body: {} },
    );
    expect(cancelled.status).toBe(204);
    expect(calls.filter((c) => c.method === "cancel")).toHaveLength(0);
    const before = started.length;
    await startQueuedCase(environment, queued.at(-1)!);
    expect(started).toHaveLength(before);
    const status = await operator.call<CaseBody>(
      `/v1/orgs/${org}/cases/${created.body.id}`,
    );
    expect(status.body.status).toBe("cancelled");
  });
});

describe("completing a case", () => {
  let caseId: string;
  const complete = (who: Client) =>
    who.call<{ status?: string; error?: { code: string; message: string } }>(
      `/v1/orgs/${org}/cases/${caseId}/complete`,
      { body: {} },
    );
  const status = (s: "running" | "waiting") =>
    recordCaseEvent(environment, {
      organizationId: org,
      agentId,
      caseId,
      type: "status",
      status: s,
      waitingOn: null,
      reason: null,
      answers: null,
      error: null,
    });

  beforeAll(async () => {
    const created = await operator.call<Accepted>(`/v1/orgs/${org}/cases`, {
      body: { agent: "invoices", text: "Invoice 2003" },
    });
    caseId = created.body.id;
    await startQueuedCase(environment, queued.at(-1)!);
  });

  it("is for people who work the case, on a waiting case", async () => {
    await status("running");
    const running = await complete(operator);
    expect(running.status).toBe(409);
    expect(running.body.error?.code).toBe("case_not_completable");
    await status("waiting");
    expect((await complete(admin)).status).toBe(403);
    expect((await complete(outsider)).status).toBe(404);
    expect(calls.filter((c) => c.method === "complete")).toHaveLength(0);
  });

  it("refuses while the checks or success condition fail, then completes", async () => {
    const refused = await complete(operator);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({
      code: "case_not_done",
      message: "Checks failing: amountPositive",
    });
    completion = {
      result: "ok",
      state: { status: "completed", run: 1, answers: {}, checks: [] },
    };
    const done = await complete(operator);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("completed");
    expect(calls.filter((c) => c.method === "complete")).toHaveLength(2);
  });
});

describe("approvals", () => {
  const pending = {
    id: "apr_pending",
    level: "tool",
    target: "pay_invoice",
    group: "accounts-payable",
    payload: { amount: 120 },
    reason: "Payments need a check",
    status: "pending",
    run: 1,
    requestedAt: Date.now(),
    decidedBy: null,
    decidedAt: null,
    note: null,
  };
  const decided = { ...pending, id: "apr_decided", status: "approved" };
  const anyOperator = { ...pending, id: "apr_any", group: null };
  let caseId: string;
  const status = (s: "running" | "waiting") =>
    recordCaseEvent(environment, {
      organizationId: org,
      agentId,
      caseId,
      type: "status",
      status: s,
      waitingOn: s === "waiting" ? "accounts-payable" : null,
      reason: null,
      answers: null,
      error: null,
      ...(s === "waiting" && { approvalId: pending.id }),
    });
  const decide = (
    who: Client,
    id: string,
    action: "approve" | "reject",
    body: Record<string, unknown> = {},
  ) =>
    who.call<{ error?: { code: string } }>(
      `/v1/orgs/${org}/cases/${caseId}/approvals/${id}/${action}`,
      { body },
    );

  beforeAll(async () => {
    const created = await operator.call<Accepted>(`/v1/orgs/${org}/cases`, {
      body: { agent: "invoices", text: "Pay invoice 2002" },
    });
    caseId = created.body.id;
    await startQueuedCase(environment, queued.at(-1)!);
    await status("waiting");
    roomState = {
      status: "waiting",
      run: 1,
      answers: null,
      checks: [],
      approvals: [pending, decided, anyOperator],
    };
  });

  it("are decided only by people who work the case and are in the named group", async () => {
    // Ana works the case as a Developer but is not in accounts-payable.
    expect((await decide(owner, pending.id, "approve")).status).toBe(403);
    expect((await decide(admin, anyOperator.id, "approve")).status).toBe(403);
    expect((await decide(outsider, pending.id, "approve")).status).toBe(404);
    const created = await owner.call<{ key: string }>(
      "/api/auth/api-key/create",
      { body: { name: "approvals", organizationId: org } },
    );
    const key = new Client(environment, {
      authorization: `Bearer ${created.body.key}`,
    });
    expect((await decide(key, pending.id, "approve")).status).toBe(403);
    expect((await decide(owner, anyOperator.id, "approve")).status).toBe(200);
    expect(calls.filter((c) => c.method === "decide")).toHaveLength(1);
  });

  it("refuse unknown and decided approvals, a running case, and a reject without a reason", async () => {
    expect((await decide(operator, "apr_nope", "approve")).status).toBe(404);
    const again = await decide(operator, decided.id, "approve");
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("approval_decided");
    await status("running");
    const running = await decide(operator, pending.id, "approve");
    expect(running.status).toBe(409);
    expect(running.body.error?.code).toBe("case_running");
    await status("waiting");
    expect((await decide(operator, pending.id, "reject")).status).toBe(400);
  });

  it("pass the decision to the runtime, and record it in the case room and the audit log", async () => {
    const before = calls.length;
    const approved = await decide(operator, pending.id, "approve", {
      note: "Matches the PO",
    });
    expect(approved.status).toBe(200);
    const rejected = await decide(operator, pending.id, "reject", {
      reason: "Wrong vendor",
    });
    expect(rejected.status).toBe(200);
    expect(calls.slice(before)).toEqual([
      {
        method: "decide",
        input: expect.objectContaining({
          caseId,
          id: pending.id,
          approve: true,
          userId: operatorId,
          note: "Matches the PO",
        }) as unknown,
      },
      {
        method: "decide",
        input: expect.objectContaining({
          approve: false,
          note: "Wrong vendor",
        }) as unknown,
      },
    ]);
    const events = await withOrg(environment, orgId(org), (tx) =>
      tx
        .select()
        .from(reviewEvents)
        .where(eq(reviewEvents.caseId, caseId))
        .orderBy(asc(reviewEvents.at)),
    );
    expect(
      events
        .slice(-2)
        .map((e) => [e.kind, e.path, (e.after as { note: string }).note]),
    ).toEqual([
      ["approval.approved", "pay_invoice", "Matches the PO"],
      ["approval.rejected", "pay_invoice", "Wrong vendor"],
    ]);
    const audited = await withOrg(environment, orgId(org), (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.caseId, caseId),
            sql`${auditEvents.data}->>'approval' = ${pending.id}`,
          ),
        )
        .orderBy(asc(auditEvents.seq)),
    );
    // The person's note is case content: it stays in the review events,
    // which go with the case, and never enters the audit log.
    expect(
      audited.map((a) => [
        a.action,
        a.actorId,
        a.data.approval,
        "note" in a.data,
      ]),
    ).toEqual([
      ["case.approval.approved", operatorId, pending.id, false],
      ["case.approval.rejected", operatorId, pending.id, false],
    ]);
  });
});

describe("the outbox", () => {
  it("re-sends a start whose queue send failed", async () => {
    queueDown = true;
    const created = await operator.call<Accepted>(`/v1/orgs/${org}/cases`, {
      body: { agent: "invoices", text: "queue was down" },
    });
    queueDown = false;
    expect(created.status).toBe(202);
    const undrained = () =>
      withOrg(environment, orgId(org), (tx) =>
        tx
          .select()
          .from(outbox)
          .where(
            and(
              eq(outbox.kind, "case.start"),
              sql`${outbox.payload}->>'caseId' = ${created.body.id}`,
            ),
          ),
      );
    const [row] = await undrained();
    expect(row).toMatchObject({ drainedAt: null, attempts: 1 });
    await withOrg(environment, orgId(org), (tx) =>
      tx
        .update(outbox)
        .set({ createdAt: sql`now() - interval '2 minutes'` })
        .where(eq(outbox.id, row!.id)),
    );
    await sweepOutbox(environment);
    const [after] = await undrained();
    expect(after?.drainedAt).not.toBeNull();
    expect(queued.at(-1)).toMatchObject({ outboxId: row!.id });
  });
});

describe("files and OCR", () => {
  const upload = async (
    bytes: string | Uint8Array,
    name: string,
    type: string,
  ) => {
    const form = new FormData();
    form.append("file", new File([bytes], name, { type }));
    const response = await worker.fetch(
      new Request(new URL(`/v1/orgs/${org}/files`, environment.APP_URL), {
        method: "POST",
        headers: { cookie: operator.cookie, origin: environment.APP_URL },
        body: form,
      }),
      environment,
      {
        waitUntil: () => {},
        passThroughOnException: () => {},
        props: {},
      },
    );
    expect(response.status).toBe(201);
    return response.json<{ id: string; size: number }>();
  };

  it("stores an upload under the organization, and a file joins one case", async () => {
    const file = await upload("hello", "note.txt", "text/plain");
    expect(file.size).toBe(5);
    expect(
      await (await environment.FILES.get(`${org}/files/${file.id}`))?.text(),
    ).toBe("hello");
    const ocr = await operator.call<{ error: { code: string } }>(
      `/v1/orgs/${org}/ocr`,
      { body: { file: file.id } },
    );
    expect(ocr.status).toBe(415);
    const started = await operator.call<Accepted>(`/v1/orgs/${org}/cases`, {
      body: { agent: "invoices", files: [file.id] },
    });
    expect(started.status).toBe(202);
    expect(
      (
        await operator.call(`/v1/orgs/${org}/cases`, {
          body: { agent: "invoices", files: [file.id] },
        })
      ).status,
    ).toBe(404);
  });

  it("attaches files to a started case for people who work it, and hands them to the next run", async () => {
    const created = await operator.call<Accepted>(`/v1/orgs/${org}/cases`, {
      body: { agent: "invoices", text: "Invoice 2004" },
    });
    const caseId = created.body.id;
    await startQueuedCase(environment, queued.at(-1)!);
    await recordCaseEvent(environment, {
      organizationId: org,
      agentId,
      caseId,
      type: "status",
      status: "waiting",
      waitingOn: null,
      reason: null,
      answers: null,
      error: null,
    });
    const file = await upload("receipt", "receipt.txt", "text/plain");
    const path = `/v1/orgs/${org}/cases/${caseId}/files`;
    expect(
      (await admin.call(path, { body: { files: [file.id] } })).status,
    ).toBe(403);
    expect(
      (await outsider.call(path, { body: { files: [file.id] } })).status,
    ).toBe(404);
    const attached = await operator.call<{ files: { id: string }[] }>(path, {
      body: { files: [file.id] },
    });
    expect(attached.status).toBe(200);
    expect(attached.body.files.map((f) => f.id)).toEqual([file.id]);
    const again = await operator.call<{ error: { code: string } }>(path, {
      body: { files: [file.id] },
    });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe("invalid_files");
    const listed = await owner.call<{ files: { id: string; name: string }[] }>(
      path,
    );
    expect(listed.body.files).toMatchObject([
      { id: file.id, name: "receipt.txt" },
    ]);

    // Anyone who sees the case downloads it, always as a sandboxed attachment.
    const download = (cookie: string, fileId = file.id) =>
      worker.fetch(
        new Request(new URL(`${path}/${fileId}`, environment.APP_URL), {
          headers: { cookie, origin: environment.APP_URL },
        }),
        environment,
        { waitUntil: () => {}, passThroughOnException: () => {}, props: {} },
      );
    const bytes = await download(owner.cookie);
    expect(bytes.status).toBe(200);
    expect(await bytes.text()).toBe("receipt");
    expect(bytes.headers.get("content-type")).toBe("text/plain");
    expect(bytes.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''receipt.txt",
    );
    expect(bytes.headers.get("content-security-policy")).toBe("sandbox");
    expect((await download(outsider.cookie)).status).toBe(404);
    const loose = await upload("loose", "loose.txt", "text/plain");
    expect((await download(owner.cookie, loose.id)).status).toBe(404);

    calls.length = 0;
    expect(
      (
        await operator.call(`/v1/orgs/${org}/cases/${caseId}/rerun`, {
          body: {},
        })
      ).status,
    ).toBe(200);
    expect(calls.find((c) => c.method === "rerun")?.input.notes).toEqual([
      {
        kind: "file.added",
        path: null,
        before: null,
        after: { id: file.id, name: "receipt.txt", contentType: "text/plain" },
      },
    ]);
  });

  it("reads a page image, and a PDF page by page through the renderer", async () => {
    // The model service is the stub, called in this isolate.
    const fetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const request = new Request(input, init);
      return new URL(request.url).hostname === "model-stub.test"
        ? Promise.resolve(modelStub.fetch(request, {}))
        : fetch(request);
    });
    const png = Uint8Array.from(atob(acmeInvoice.split(",")[1]!), (c) =>
      c.charCodeAt(0),
    );
    const image = await upload(png, "acme-invoice.png", "image/png");
    const read = await operator.call<{
      pages: { index: number; markdown: string; blocks?: unknown[] }[];
      model: string;
    }>(`/v1/orgs/${org}/ocr`, { body: { file: image.id, grounding: true } });
    expect(read.status).toBe(200);
    expect(read.body.model).toBe("stub-mistral-ocr");
    expect(read.body.pages[0]?.markdown).toContain("Invoice 1042");
    expect(read.body.pages[0]?.blocks?.length).toBeGreaterThan(0);

    const pdf = await upload(
      "%PDF-1.7 /Type /Pages /Type /Page /Type /Page",
      "invoice.pdf",
      "application/pdf",
    );
    const pages = await operator.call<{
      pages: { index: number; markdown: string }[];
    }>(`/v1/orgs/${org}/ocr`, { body: { file: pdf.id } });
    expect(pages.status).toBe(200);
    expect(pages.body.pages.map((p) => p.index)).toEqual([0, 1]);
    expect(pages.body.pages[1]?.markdown).toMatch(/^# Stub OCR/);
    vi.restoreAllMocks();
  });
});
