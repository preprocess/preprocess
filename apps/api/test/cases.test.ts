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
import { deployments } from "@preprocess/db/schema/deployments";
import { and, asc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

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

const runtime: Runtime = {
  manifest: () => Promise.reject(new Error("unused")),
  getCase: () => Promise.reject(new Error("unused")),
  startCase: (start) => {
    started.push(start);
    return Promise.resolve({});
  },
  caseState: () =>
    Promise.resolve({
      status: "completed",
      run: 1,
      answers: { vendor: "globex" },
      checks: [],
    }),
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
      scriptName: `${org}--invoices--${deploymentId}`,
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

  it("reads a page image, and a PDF page by page through the renderer", async () => {
    const png = Uint8Array.from(atob(acmeInvoice.split(",")[1]!), (c) =>
      c.charCodeAt(0),
    );
    const image = await upload(png, "acme-invoice.png", "image/png");
    const read = await operator.call<{
      pages: { index: number; markdown: string; blocks?: unknown[] }[];
      model: string;
    }>(`/v1/orgs/${org}/ocr`, { body: { file: image.id, grounding: true } });
    expect(read.status).toBe(200);
    expect(read.body.model).toBe("stub-lightonocr");
    expect(read.body.pages[0]?.markdown).toContain("Invoice 1042");
    expect(read.body.pages[0]?.blocks?.length).toBeGreaterThan(0);

    const pdf = await upload(
      "%PDF-1.7 two pages",
      "invoice.pdf",
      "application/pdf",
    );
    const rendered: Uint8Array[] = [];
    environment.PDF_RENDER = {
      renderPdf: (bytes) => {
        rendered.push(bytes);
        return Promise.resolve([png, png]);
      },
    };
    const pages = await operator.call<{
      pages: { index: number; markdown: string }[];
    }>(`/v1/orgs/${org}/ocr`, { body: { file: pdf.id } });
    expect(pages.status).toBe(200);
    expect(new TextDecoder().decode(rendered[0])).toBe("%PDF-1.7 two pages");
    expect(pages.body.pages.map((p) => p.index)).toEqual([0, 1]);
    expect(pages.body.pages[1]?.markdown).toContain("Invoice 1042");
  });
});
