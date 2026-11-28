// Feedback about Preprocess (PRE-164): tenant isolation (an organization
// can't attach another's agent or case, and reads only its own feedback),
// validation, the hourly limit per API key and per person, the email to us
// on our cloud only and only with FEEDBACK_EMAIL_TO set, and the product
// event carrying the category alone.

import { env } from "cloudflare:workers";
import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { auditEvents } from "@preprocess/db/schema/audit";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { feedback } from "@preprocess/db/schema/feedback";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { Env } from "../src/env.ts";
import {
  FEEDBACK_WINDOW_MS,
  LIMITS,
  rateLimitName,
} from "../src/rate-limit.ts";
import {
  Client,
  createOrganization,
  sent,
  signUp,
  testEnv,
  tracked,
} from "./helpers.ts";

const TO = "feedback@preprocess.test";
const hosted = testEnv({ POSTHOG_KEY: "phc_test", FEEDBACK_EMAIL_TO: TO });

type Receipt = { id: string; createdAt: string };
type Failure = { error: { code: string; message: string } };

let owner: Client;
let ownerId: string;
let org: string;
let agentId: string;
let caseId: string;
let otherOrg: string;
let otherAgentId: string;
let otherCaseId: string;

const seedAgentAndCase = async (organization: string, slug: string) => {
  const agent = newId("agent");
  const kase = newId("case");
  const deployment = newId("deployment");
  await withOrg(hosted, orgId(organization), async (tx) => {
    await tx
      .insert(agents)
      .values({ id: agent, organizationId: organization, slug });
    await tx.insert(deployments).values({
      id: deployment,
      organizationId: organization,
      agentId: agent,
      environment: "production",
      status: "ready",
      bundleSha256: "00",
      sdkVersion: "0.1.0",
      manifest: {},
      source: "cli",
      createdBy: ownerId,
    });
    await tx.insert(cases).values({
      id: kase,
      organizationId: organization,
      agentId: agent,
      deploymentId: deployment,
      status: "completed",
      source: "api",
    });
  });
  return { agent, kase };
};

const newKey = async (name: string, organization = org) => {
  const created = await owner.call<{ id: string; key: string }>(
    "/api/auth/api-key/create",
    { body: { name, organizationId: organization } },
  );
  return created.body;
};

const keyed = (key: string, environment: Env = hosted) =>
  new Client(environment, { authorization: `Bearer ${key}` });

const send = <T = Receipt>(
  client: Client,
  body: Record<string, unknown>,
  target = org,
) =>
  client.call<T>(`/v1/orgs/${target}/feedback`, {
    body: { category: "bug", message: "The deploy log stops early.", ...body },
  });

const stored = (id: string, organization = org) =>
  withOrg(hosted, orgId(organization), (tx) =>
    tx.select().from(feedback).where(eq(feedback.id, id)),
  );

beforeAll(async () => {
  const ana = await signUp("Ana Feedback", hosted);
  owner = ana.client;
  ownerId = ana.userId;
  org = await createOrganization(owner, "Feedback Acme");
  otherOrg = await createOrganization(owner, "Feedback Globex");
  ({ agent: agentId, kase: caseId } = await seedAgentAndCase(org, "intake"));
  ({ agent: otherAgentId, kase: otherCaseId } = await seedAgentAndCase(
    otherOrg,
    "billing",
  ));
});

describe("POST /feedback", () => {
  it("records feedback from an API key with its agent, case and client", async () => {
    const key = await newKey("agent");
    const response = await send(keyed(key.key), {
      category: "idea",
      message: "I needed a way to list builds by branch.",
      agent: "intake",
      case: caseId,
      client: "claude-code 2.1",
    });
    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual(["createdAt", "id"]);
    const [row] = await stored(response.body.id);
    expect(row).toMatchObject({
      organizationId: org,
      createdByUserId: null,
      apiKeyId: key.id,
      category: "idea",
      message: "I needed a way to list builds by branch.",
      agentId,
      caseId,
      client: "claude-code 2.1",
    });
    const [event] = await withOrg(hosted, orgId(org), (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, "feedback.submitted"),
            eq(auditEvents.targetId, response.body.id),
          ),
        ),
    );
    expect(event).toMatchObject({ actorType: "api_key", actorId: key.id });
  });

  it("records a signed-in person's feedback as theirs", async () => {
    const response = await send(owner, { category: "question" });
    expect(response.status).toBe(201);
    const [row] = await stored(response.body.id);
    expect(row).toMatchObject({ createdByUserId: ownerId, apiKeyId: null });
  });

  it("takes the client from the MCP header when the body names none", async () => {
    const key = await newKey("header");
    const client = new Client(hosted, {
      authorization: `Bearer ${key.key}`,
      "x-preprocess-client": "mcp",
    });
    const response = await send(client, {});
    const [row] = await stored(response.body.id);
    expect(row!.client).toBe("mcp");
  });

  it("validates the category, the message and the client", async () => {
    const client = keyed((await newKey("validation")).key);
    for (const body of [
      { category: "complaint" },
      { message: "" },
      { message: "   " },
      { message: "x".repeat(5001) },
      { client: "c".repeat(101) },
    ]) {
      const response = await send<Failure>(client, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe("invalid_request");
    }
    expect((await send(client, { message: "x".repeat(5000) })).status).toBe(
      201,
    );
  });
});

describe("tenant isolation", () => {
  it("refuses another organization's agent or case", async () => {
    const client = keyed((await newKey("isolation")).key);
    for (const body of [
      { agent: otherAgentId },
      { agent: "billing" },
      { case: otherCaseId },
      { agent: agentId, case: otherCaseId },
    ]) {
      const response = await send<Failure>(client, body);
      expect(response.status, JSON.stringify(body)).toBe(404);
      expect(response.body.error.code).toBe("not_found");
    }
    const rows = await withOrg(hosted, orgId(org), (tx) =>
      tx.select().from(feedback).where(eq(feedback.caseId, otherCaseId)),
    );
    expect(rows).toEqual([]);
  });

  it("refuses another organization's key", async () => {
    const elsewhere = await newKey("elsewhere", otherOrg);
    expect((await send(keyed(elsewhere.key), {})).status).toBe(403);
  });

  it("shows each organization only its own feedback", async () => {
    const response = await send(keyed((await newKey("scoped")).key), {});
    expect(await stored(response.body.id, otherOrg)).toEqual([]);
    const own = await withOrg(hosted, orgId(org), (tx) =>
      tx.select({ org: feedback.organizationId }).from(feedback),
    );
    expect(new Set(own.map((r) => r.org))).toEqual(new Set([org]));
  });
});

describe("the hourly limit", () => {
  it("allows 20 an hour for one API key and not its organization's other keys", async () => {
    const first = keyed((await newKey("busy")).key);
    for (let i = 0; i < LIMITS.feedback; i++)
      expect((await send(first, { message: `Item ${i}` })).status).toBe(201);
    const limited = await send<Failure>(first, {});
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(FEEDBACK_WINDOW_MS / 1000);
    expect((await send(keyed((await newKey("calm")).key), {})).status).toBe(
      201,
    );
  });

  it("limits a session per person", async () => {
    const bea = await signUp("Bea Feedback", hosted);
    const beaOrg = await createOrganization(bea.client, "Feedback Bea");
    const limiter = env.RATE_LIMITER.getByName(rateLimitName.org(beaOrg));
    for (let i = 0; i < LIMITS.feedback; i++)
      await limiter.take([
        {
          name: `feedback:user:${bea.userId}`,
          limit: LIMITS.feedback,
          windowMs: FEEDBACK_WINDOW_MS,
        },
      ]);
    expect((await send(bea.client, {}, beaOrg)).status).toBe(429);
    expect((await send(owner, {})).status).toBe(201);
  });
});

describe("the email to Preprocess", () => {
  const mailTo = (id: string) =>
    sent.filter((m) => m.to === TO && m.text.includes(id));

  it("goes out on our cloud with FEEDBACK_EMAIL_TO set", async () => {
    const response = await send(keyed((await newKey("Intake agent")).key), {
      message: "search_logs ignores the level filter.",
      agent: agentId,
      case: caseId,
      client: "cursor",
    });
    const [mail] = mailTo(response.body.id);
    expect(mail).toBeDefined();
    expect(mail!.subject).toBe("Feedback (bug) from Feedback Acme");
    for (const line of [
      `Organization: Feedback Acme (${org})`,
      "Category: bug",
      `Agent: ${agentId}`,
      `Case: ${caseId}`,
      "Client: cursor",
      "Submitted by: API key Intake agent",
      "search_logs ignores the level filter.",
    ])
      expect(mail!.text).toContain(line);
  });

  it("isn't sent without FEEDBACK_EMAIL_TO or on a self-hosted install", async () => {
    const key = (await newKey("quiet")).key;
    const unset = await send(keyed(key, testEnv()), {});
    expect(unset.status).toBe(201);
    expect(mailTo(unset.body.id)).toEqual([]);
    const selfHosted = testEnv({
      PREPROCESS_REGION: undefined,
      FEEDBACK_EMAIL_TO: TO,
    } as unknown as Partial<Env>);
    const local = await send(keyed(key, selfHosted), {});
    expect(local.status).toBe(201);
    expect(await stored(local.body.id)).toHaveLength(1);
    expect(mailTo(local.body.id)).toEqual([]);
  });

  it("doesn't fail the request when the send fails", async () => {
    const failing = testEnv({
      FEEDBACK_EMAIL_TO: TO,
      EMAIL: {
        send: () => Promise.reject(new Error("mail is down")),
      } as unknown as SendEmail,
    });
    const response = await send(keyed((await newKey("down")).key, failing), {});
    expect(response.status).toBe(201);
    expect(await stored(response.body.id)).toHaveLength(1);
  });
});

describe("the product event", () => {
  it("carries the category and nothing else of the feedback", async () => {
    const response = await send(owner, {
      category: "other",
      message: "A private note about invoice 4411.",
      agent: agentId,
      case: caseId,
      client: "claude-code",
    });
    expect(response.status).toBe(201);
    const event = [...tracked]
      .reverse()
      .find((e) => e.event === "feedback_submitted");
    expect(event).toBeDefined();
    expect(event!.distinctId).toBe(ownerId);
    expect(event!.properties.category).toBe("other");
    const text = JSON.stringify(event!.properties);
    for (const value of [
      "invoice 4411",
      agentId,
      caseId,
      response.body.id,
      "claude-code",
    ])
      expect(text).not.toContain(value);
    for (const key of ["message", "agent_id", "case_id", "client"])
      expect(event!.properties).not.toHaveProperty(key);
  });
});
