import { ModelError } from "@preprocess/models/client";
import { OpenAPIHono } from "@hono/zod-openapi";
import { runMode } from "@preprocess/runmode";
import { orgId } from "@preprocess/db/client";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import { anchorAll, publicKeys } from "./audit-anchor.ts";
import { handleAuthRequest } from "./auth.ts";
import { orgCaller } from "./caller.ts";
import type { OrgVariables } from "./caller.ts";
import { startQueuedCase } from "./cases.ts";
import { syncAgent } from "./deploy.ts";
import type { Env, Job } from "./env.ts";
import { deleteExpiredIdempotencyKeys } from "./idempotency.ts";
import { readOutbox, sweepOutbox } from "./outbox.ts";
import type { OutboxMessage } from "./outbox.ts";
import { agentRoutes } from "./routes/agents.ts";
import { caseRoutes } from "./routes/cases.ts";
import { webhookRoutes } from "./routes/webhooks.ts";
import { inboxRoutes } from "./routes/inbox.ts";
import { sendNotice } from "./notify.ts";
import { deliverWebhook } from "./webhooks.ts";
import { auditRoutes } from "./routes/audit.ts";
import { groupRoutes } from "./routes/groups.ts";
import { organizationRoutes } from "./routes/organization.ts";
import { mcpCallback, mcpRoutes } from "./routes/mcp.ts";
import { secretRoutes } from "./routes/secrets.ts";
import { spendingRoutes } from "./routes/spending.ts";

export { Counter } from "./counter.ts";
export { McpService } from "./mcp.ts";
export { Platform } from "./platform.ts";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.onError((error, c) => {
  if (error instanceof HTTPException)
    return error.res
      ? error.getResponse()
      : c.json({ error: error.message || "error" }, error.status);
  if (error instanceof ModelError)
    return c.json(
      { error: error.code, message: error.message },
      error.status as 400 | 429 | 502 | 503 | 504,
    );
  console.error(error);
  return c.text("Internal Server Error", 500);
});

app.get("/", (c) =>
  c.json({
    service: "api",
    stage: c.env.STAGE,
    runMode: runMode(c.env),
    modelService: c.env.MODEL_SERVICE_URL ? "configured" : "none",
  }),
);

// Better Auth: sign-up, sign-in, sessions, organizations, members,
// invitations and API keys. The app serves these on its own origin.
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  handleAuthRequest(c.env, c.req.raw),
);

// The public half of the audit signing key, for checking manifests.
app.get("/v1/audit/keys", async (c) => c.json(await publicKeys(c.env)));

const orgApi = new OpenAPIHono<{ Bindings: Env; Variables: OrgVariables }>();
orgApi.use(orgCaller);
orgApi.route("/", organizationRoutes);
orgApi.route("/", groupRoutes);
orgApi.route("/", auditRoutes);
orgApi.route("/", agentRoutes);
orgApi.route("/", secretRoutes);
orgApi.route("/", mcpRoutes);
orgApi.route("/", caseRoutes);
orgApi.route("/", spendingRoutes);
orgApi.route("/", webhookRoutes);
orgApi.route("/", inboxRoutes);

const v1 = new OpenAPIHono<{ Bindings: Env }>();
v1.route("/orgs/:org", orgApi);
v1.route("/", mcpCallback);
v1.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "Preprocess API", version: "1" },
});
app.route("/v1", v1);

app.post("/orgs/:org/counter", async (c) => {
  const counter = c.env.COUNTER.getByName(`${c.req.param("org")}:counter`);
  return c.json({ count: await counter.increment() });
});

app.post("/orgs/:org/jobs", async (c) => {
  const job: Job = {
    organizationId: c.req.param("org"),
    id: crypto.randomUUID(),
    requestedAt: new Date().toISOString(),
  };
  await c.env.JOBS.send(job);
  return c.json(job, 202);
});

app.get("/orgs/:org/jobs/:id", async (c) => {
  const object = await c.env.FILES.get(
    `${c.req.param("org")}/jobs/${c.req.param("id")}.json`,
  );
  if (!object) return c.json({ status: "pending" }, 404);
  return c.json(await object.json());
});

app.get("/dispatch", async (c) => {
  const worker =
    c.env.DISPATCHER?.get(c.env.USER_WORKER) ?? c.env.LOCAL_USER_WORKER;
  if (!worker) return c.json({ error: "no dispatch binding" }, 500);
  const response = await worker.fetch(new Request("https://user-worker/"));
  return c.json({
    via: c.env.DISPATCHER ? "dispatch-namespace" : "local-service-binding",
    status: response.status,
    body: await response.json(),
  });
});

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    // Every minute: re-send outbox rows a failed queue send left behind.
    if (controller.cron === "* * * * *") {
      ctx.waitUntil(sweepOutbox(env));
      return;
    }
    // 00:20 UTC: sign and store yesterday's audit chain for every
    // organization, and forget expired idempotency keys.
    ctx.waitUntil(anchorAll(env, new Date(controller.scheduledTime)));
    ctx.waitUntil(deleteExpiredIdempotencyKeys(env));
  },
  async queue(batch: MessageBatch<Job | OutboxMessage>, env: Env) {
    if (batch.queue.startsWith("preprocess-cases-")) {
      // A start that throws is retried by the queue.
      for (const message of batch.messages as Message<OutboxMessage>[]) {
        await startQueuedCase(env, message.body);
        message.ack();
      }
      return;
    }
    if (batch.queue.startsWith("preprocess-emails-")) {
      for (const message of batch.messages as Message<OutboxMessage>[]) {
        try {
          await sendNotice(env, message.body);
          message.ack();
        } catch (error) {
          console.error(
            JSON.stringify({ event: "notice.failed", error: String(error) }),
          );
          message.retry();
        }
      }
      return;
    }
    if (batch.queue.startsWith("preprocess-webhooks-")) {
      for (const message of batch.messages as Message<OutboxMessage>[]) {
        const retryIn = await deliverWebhook(env, message.body);
        if (retryIn === null) message.ack();
        else message.retry({ delaySeconds: retryIn });
      }
      return;
    }
    if (batch.queue.startsWith("preprocess-secret-sync-")) {
      // Retried with backoff until it succeeds.
      for (const message of batch.messages as Message<OutboxMessage>[]) {
        try {
          const row = await readOutbox(env, message.body);
          if (row)
            await syncAgent(
              env,
              orgId(row.organizationId),
              (row.payload as { agentId: string }).agentId,
              { actorType: "platform", actorId: "secret-sync" },
            );
          message.ack();
        } catch (error) {
          console.error(error);
          message.retry({ delaySeconds: Math.min(300, 2 ** message.attempts) });
        }
      }
      return;
    }
    for (const message of batch.messages as Message<Job>[]) {
      // A job's result goes to R2 under its organization.
      const job = message.body;
      await env.FILES.put(
        `${job.organizationId}/jobs/${job.id}.json`,
        JSON.stringify({
          ...job,
          status: "done",
          finishedAt: new Date().toISOString(),
        }),
        { httpMetadata: { contentType: "application/json" } },
      );
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, Job | OutboxMessage>;
