// Outbound webhooks (design doc 06): who manages endpoints, which status
// changes send what, Standard Webhooks signatures, retries, rotation, and
// disabling an endpoint that keeps failing.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents, groups } from "@preprocess/db/schema/access";
import { cases, idempotencyKeys } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { webhookDeliveries } from "@preprocess/db/schema/webhooks";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { recordCaseEvent } from "../src/cases.ts";
import type { Env } from "../src/env.ts";
import type { OutboxMessage } from "../src/outbox.ts";
import { deliverWebhook, sign } from "../src/webhooks.ts";
import type { Client } from "./helpers.ts";
import {
  addMember,
  createOrganization,
  sent,
  signUp,
  testEnv,
} from "./helpers.ts";

const webhooks: OutboxMessage[] = [];
const environment: Env = testEnv({
  WEBHOOKS: {
    send: (message: OutboxMessage) => {
      webhooks.push(message);
      return Promise.resolve();
    },
  } as unknown as Queue<OutboxMessage>,
});

type Received = { url: string; headers: Headers; body: string };
let received: Received[] = [];
let answer = 200;
const receiver = () => {
  const fetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).hostname !== "hooks.example.com")
      return fetch(request);
    received.push({
      url: request.url,
      headers: request.headers,
      body: await request.text(),
    });
    return new Response(null, { status: answer });
  });
};
afterEach(() => {
  vi.restoreAllMocks();
  received = [];
  answer = 200;
});

let owner: Client;
let org: string;
let ownerEmail: string;
const agentId = newId("agent");
const deploymentId = newId("deployment");
const legal = newId("group");
const finance = newId("group");

const newCase = async (key?: string) => {
  const id = newId("case");
  await withOrg(environment, orgId(org), async (tx) => {
    await tx.insert(cases).values({
      id,
      organizationId: org,
      agentId,
      deploymentId,
      status: "running",
      source: "api",
    });
    if (key)
      await tx.insert(idempotencyKeys).values({
        organizationId: org,
        operation: "cases.create",
        key,
        caseId: id,
        fingerprint: new Uint8Array(32),
        expiresAt: new Date(Date.now() + 60_000),
      });
  });
  return { organizationId: org, agentId, caseId: id };
};

const status = (
  key: { organizationId: string; agentId: string; caseId: string },
  s: "running" | "waiting" | "halted" | "completed" | "failed" | "cancelled",
  extra: {
    waitingOn?: string;
    reason?: string;
    answers?: Record<string, unknown>;
    haltReason?: "spending_limit_reached";
  } = {},
) =>
  recordCaseEvent(environment, {
    ...key,
    type: "status",
    status: s,
    waitingOn: extra.waitingOn ?? null,
    reason: extra.reason ?? null,
    answers: extra.answers ?? null,
    error: null,
    ...(extra.haltReason && { haltReason: extra.haltReason }),
  });

const deliveriesOf = (caseId: string) =>
  withOrg(environment, orgId(org), (tx) =>
    tx
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.caseId, caseId))
      .orderBy(webhookDeliveries.createdAt),
  );

let secret: string;
let endpointId: string;

beforeAll(async () => {
  const ana = await signUp("Ana", environment);
  owner = ana.client;
  ownerEmail = ana.email;
  org = await createOrganization(owner, "Acme");
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
      createdBy: ana.userId,
      promotedAt: new Date(),
    });
    await tx.insert(groups).values([
      { id: legal, organizationId: org, slug: "legal", name: "Legal" },
      { id: finance, organizationId: org, slug: "finance", name: "Finance" },
    ]);
  });
});

describe("webhook endpoints", () => {
  it("are managed by Owners and Admins, with the secret shown once", async () => {
    const member = await addMember(owner, org, "Mo");
    expect(
      (
        await member.client.call(`/v1/orgs/${org}/webhooks`, {
          body: {
            url: "https://hooks.example.com/a",
            events: ["case.completed"],
          },
        })
      ).status,
    ).toBe(403);
    for (const url of [
      "http://hooks.example.com/a",
      "https://127.0.0.1/a",
      "https://10.1.2.3/a",
      "https://[::1]/a",
      "https://localhost/a",
    ])
      expect(
        (
          await owner.call(`/v1/orgs/${org}/webhooks`, {
            body: { url, events: ["case.completed"] },
          })
        ).status,
        url,
      ).toBe(400);

    const created = await owner.call<{ id: string; signingSecret: string }>(
      `/v1/orgs/${org}/webhooks`,
      {
        body: {
          url: "https://hooks.example.com/preprocess",
          events: ["case.completed", "case.failed", "case.needs_group"],
        },
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.signingSecret).toMatch(/^whsec_/);
    secret = created.body.signingSecret;
    endpointId = created.body.id;
    const read = await owner.call<Record<string, unknown>>(
      `/v1/orgs/${org}/webhooks/${endpointId}`,
    );
    expect(read.body).not.toHaveProperty("signingSecret");

    const other = await signUp("Olga", environment);
    const otherOrg = await createOrganization(other.client, "Elsewhere");
    expect(
      (await other.client.call(`/v1/orgs/${otherOrg}/webhooks/${endpointId}`))
        .status,
    ).toBe(404);
    expect(
      (await other.client.call(`/v1/orgs/${org}/webhooks/${endpointId}`))
        .status,
    ).toBe(403);
  });
});

describe("a case's status changes", () => {
  it("send a signed case.completed with the answers and the caller's key", async () => {
    receiver();
    const key = await newCase("order-77");
    await status(key, "running");
    expect(await deliveriesOf(key.caseId)).toHaveLength(0);
    await status(key, "completed", { answers: { vendor: "acme" } });
    const [delivery] = await deliveriesOf(key.caseId);
    expect(delivery).toMatchObject({
      eventType: "case.completed",
      status: "pending",
    });
    expect(webhooks.at(-1)).toMatchObject({
      organizationId: org,
      kind: "webhook",
    });

    expect(await deliverWebhook(environment, webhooks.at(-1)!)).toBeNull();
    const [hit] = received;
    expect(hit?.url).toBe("https://hooks.example.com/preprocess");
    const id = hit!.headers.get("webhook-id")!;
    const timestamp = Number(hit!.headers.get("webhook-timestamp"));
    expect(id).toBe(delivery!.id);
    expect(hit!.headers.get("webhook-signature")).toBe(
      await sign(secret, id, timestamp, hit!.body),
    );
    const payload = JSON.parse(hit!.body) as {
      type: string;
      organization: { id: string };
      data: { case: Record<string, unknown>; answers: unknown };
    };
    expect(payload).toMatchObject({
      type: "case.completed",
      organization: { id: org },
      data: {
        case: {
          id: key.caseId,
          status: "completed",
          source: "api",
          idempotencyKey: "order-77",
          deployment: { id: deploymentId, environment: "production" },
        },
        answers: { vendor: "acme" },
      },
    });
    const [after] = await deliveriesOf(key.caseId);
    expect(after).toMatchObject({
      status: "delivered",
      attempts: 1,
      lastStatusCode: 200,
    });
  });

  it("send case.needs_group on each new group, and nothing on cancel", async () => {
    const key = await newCase();
    await status(key, "waiting", {
      waitingOn: "legal",
      reason: "Payment terms",
    });
    await status(key, "waiting", { waitingOn: "legal", reason: "Still" });
    await status(key, "waiting", { waitingOn: "finance", reason: "Budget" });
    await status(key, "cancelled");
    const rows = await deliveriesOf(key.caseId);
    expect(rows.map((r) => r.eventType)).toEqual([
      "case.needs_group",
      "case.needs_group",
    ]);
    expect(
      rows.map(
        (r) =>
          (r.payload as { data: { group: { slug: string } } }).data.group.slug,
      ),
    ).toEqual(["legal", "finance"]);
  });

  it("send case.needs_group with what to approve, for a named group or any operator", async () => {
    const key = await newCase();
    const approval = (id: string, group: string | null) =>
      recordCaseEvent(environment, {
        ...key,
        type: "approval",
        approval: {
          id,
          level: "tool",
          target: "pay_invoice",
          group,
          payload: { amount: 120 },
          reason: "Payments need a check",
          status: "pending",
          run: 1,
          requestedAt: Date.now(),
          decidedBy: null,
          decidedAt: null,
          note: null,
        },
      });
    const finance = `apr_${crypto.randomUUID()}`;
    await approval(finance, "finance");
    await approval(`apr_${crypto.randomUUID()}`, null);
    await recordCaseEvent(environment, {
      ...key,
      type: "approval",
      approval: {
        id: finance,
        level: "tool",
        target: "pay_invoice",
        group: "finance",
        payload: { amount: 120 },
        reason: "Payments need a check",
        status: "approved",
        run: 1,
        requestedAt: Date.now(),
        decidedBy: "usr_x",
        decidedAt: Date.now(),
        note: null,
      },
    });
    const rows = await deliveriesOf(key.caseId);
    expect(rows.map((r) => r.eventType)).toEqual([
      "case.needs_group",
      "case.needs_group",
    ]);
    const data = rows.map(
      (r) =>
        (
          r.payload as {
            data: {
              group: { slug: string } | null;
              approval: { id: string; level: string; payload: unknown };
            };
          }
        ).data,
    );
    expect(data[0]).toMatchObject({
      group: { slug: "finance" },
      approval: { id: finance, level: "tool", payload: { amount: 120 } },
    });
    expect(data[1]?.group).toBeNull();
  });

  it("send nothing on a halt, which the index records with its reason", async () => {
    const key = await newCase();
    await status(key, "halted", { haltReason: "spending_limit_reached" });
    const halted = () =>
      withOrg(environment, orgId(org), (tx) =>
        tx
          .select({ status: cases.status, haltReason: cases.haltReason })
          .from(cases)
          .where(eq(cases.id, key.caseId)),
      );
    expect(await halted()).toEqual([
      { status: "halted", haltReason: "spending_limit_reached" },
    ]);
    expect(await deliveriesOf(key.caseId)).toEqual([]);
    await status(key, "running");
    expect(await halted()).toEqual([{ status: "running", haltReason: null }]);
  });

  it("retry a failed delivery with backoff, and sign with both secrets after a rotation", async () => {
    receiver();
    const key = await newCase();
    await status(key, "failed", { reason: "ERP unreachable" });
    answer = 500;
    expect(await deliverWebhook(environment, webhooks.at(-1)!)).toBe(30);
    expect(await deliverWebhook(environment, webhooks.at(-1)!)).toBe(120);
    const [failing] = await deliveriesOf(key.caseId);
    expect(failing).toMatchObject({
      status: "pending",
      attempts: 2,
      lastStatusCode: 500,
    });

    const rotated = await owner.call<{ signingSecret: string }>(
      `/v1/orgs/${org}/webhooks/${endpointId}/rotate-secret`,
      { body: {} },
    );
    answer = 200;
    expect(await deliverWebhook(environment, webhooks.at(-1)!)).toBeNull();
    const last = received.at(-1)!;
    const id = last.headers.get("webhook-id")!;
    const ts = Number(last.headers.get("webhook-timestamp"));
    expect(last.headers.get("webhook-signature")).toBe(
      [
        await sign(rotated.body.signingSecret, id, ts, last.body),
        await sign(secret, id, ts, last.body),
      ].join(" "),
    );
    secret = rotated.body.signingSecret;
    const log = await owner.call<{ id: string; status: string }[]>(
      `/v1/orgs/${org}/webhooks/${endpointId}/deliveries`,
    );
    expect(log.body.find((d) => d.id === id)?.status).toBe("delivered");
  });

  it("disable an endpoint that failed every delivery for 3 days, and email Admins", async () => {
    receiver();
    answer = 503;
    const key = await newCase();
    await status(key, "completed", { answers: {} });
    await withOrg(environment, orgId(org), (tx) =>
      tx
        .update(webhookDeliveries)
        .set({ deliveredAt: null, createdAt: sql`now() - interval '4 days'` })
        .where(eq(webhookDeliveries.endpointId, endpointId)),
    );
    // Past 24 hours a delivery stops retrying.
    expect(await deliverWebhook(environment, webhooks.at(-1)!)).toBeNull();
    const endpoint = await owner.call<{
      enabled: boolean;
      disabledReason: string;
    }>(`/v1/orgs/${org}/webhooks/${endpointId}`);
    expect(endpoint.body).toMatchObject({ enabled: false });
    expect(
      sent.some((m) => m.to === ownerEmail && m.subject.includes("disabled")),
    ).toBe(true);
  });
});
