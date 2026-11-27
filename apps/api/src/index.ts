import { initLogs } from "@preprocess/logs";
import type { LogRecord } from "@preprocess/logs";
import { ModelError } from "@preprocess/models/client";
import { evlog, type EvlogVariables } from "evlog/hono";
import { OpenAPIHono } from "@hono/zod-openapi";
import { runMode } from "@preprocess/runmode";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import { anchorAll, publicKeys } from "./audit-anchor.ts";
import { reportDaily, reportUsage } from "./billing.ts";
import { runPlanChanges } from "./plan-change.ts";
import { closeSilentSandboxes } from "./sandbox.ts";
import { collectSandboxLayers } from "./sandbox-layers.ts";
import { handleAuthRequest } from "./auth.ts";
import { invitationPreview } from "./invitation-preview.ts";
import { orgCaller } from "./caller.ts";
import type { OrgVariables } from "./caller.ts";
import { startQueuedCase } from "./cases.ts";
import type { Env, Job } from "./env.ts";
import { deleteExpiredIdempotencyKeys } from "./idempotency.ts";
import { sweepOutbox } from "./outbox.ts";
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
import { githubCallbacks, githubRoutes } from "./routes/github.ts";
import { mcpCallback, mcpRoutes } from "./routes/mcp.ts";
import { secretRoutes } from "./routes/secrets.ts";
import { guardrailRoutes } from "./routes/guardrails.ts";
import { sandboxRoutes } from "./routes/sandboxes.ts";
import { scheduleRoutes } from "./routes/schedules.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { spendingRoutes } from "./routes/spending.ts";
import { retentionRoutes } from "./routes/retention.ts";
import { sweepRetention } from "./retention.ts";
import { billingRoutes } from "./routes/billing.ts";
import { autumnWebhook } from "./routes/autumn.ts";
import { ingestLogs, sendLogs } from "./logs.ts";
import { startQueuedEval } from "./evals.ts";
import { exportLogs, type OtelRetry } from "./otel.ts";
import { logRoutes } from "./routes/logs.ts";
import { otelRoutes } from "./routes/otel.ts";
import { evalRoutes } from "./routes/evals.ts";
import { memoryRoutes } from "./routes/memories.ts";
import { trainingRoutes, trainingTag } from "./routes/training.ts";
import { meRoutes } from "./routes/me.ts";
import { buildTools, handleMcp, type Tool } from "./mcp-server.ts";

export { BuildQueue } from "./builds.ts";
export { Counter } from "./counter.ts";
export { Scheduler } from "./scheduler.ts";
export { McpService } from "./mcp.ts";
export { Platform } from "./platform.ts";

const OPENAPI = {
  openapi: "3.1.0",
  info: { title: "Preprocess API", version: "1" },
};

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

// A signed-out invitee's view of their invitation, for the app's invitation
// page. Not part of /v1.
app.get("/api/invitations/:id", async (c) => {
  const preview = await invitationPreview(c.env, c.req.param("id"));
  return preview ? c.json(preview) : c.json({ error: "not_found" }, 404);
});

// The public half of the audit signing key, for checking manifests.
app.get("/v1/audit/keys", async (c) => c.json(await publicKeys(c.env)));

const orgApi = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables & EvlogVariables["Variables"];
}>();
// One wide event per request (design doc 09). It joins the organization's
// run log only once the caller is known to belong to it.
orgApi.use(async (c, next) => {
  initLogs("api", (records) => sendLogs(c.env, records));
  await next();
});
orgApi.use(evlog());
orgApi.use(orgCaller);
orgApi.use(async (c, next) => {
  c.get("log").set({ organizationId: c.var.org });
  await next();
});
orgApi.route("/", organizationRoutes);
orgApi.route("/", groupRoutes);
orgApi.route("/", auditRoutes);
orgApi.route("/", agentRoutes);
orgApi.route("/", secretRoutes);
orgApi.route("/", mcpRoutes);
orgApi.route("/", caseRoutes);
orgApi.route("/", githubRoutes);
orgApi.route("/", spendingRoutes);
orgApi.route("/", billingRoutes);
orgApi.route("/", guardrailRoutes);
orgApi.route("/", sandboxRoutes);
orgApi.route("/", settingsRoutes);
orgApi.route("/", retentionRoutes);
orgApi.route("/", scheduleRoutes);
orgApi.route("/", webhookRoutes);
orgApi.route("/", inboxRoutes);
orgApi.route("/", logRoutes);
orgApi.route("/", otelRoutes);
orgApi.route("/", evalRoutes);
orgApi.route("/", memoryRoutes);
orgApi.route("/", trainingRoutes);

// The MCP server (src/mcp-server.ts) takes an organization API key, and each
// tool call is a request to this API with the same key, so the API's own
// permission checks decide what a tool may do.
let mcpTools: Tool[] | undefined;
orgApi.post("/mcp", async (c) => {
  if (c.var.caller.type !== "api_key")
    throw new HTTPException(401, {
      message: "The MCP server takes an organization API key.",
    });
  const message = (await c.req.json().catch(() => null)) as Parameters<
    typeof handleMcp
  >[0];
  const answer = await handleMcp(
    message,
    () =>
      (mcpTools ??= buildTools(
        v1.getOpenAPI31Document(OPENAPI) as unknown as Parameters<
          typeof buildTools
        >[0],
      )),
    (request) =>
      app.fetch(
        new Request(
          new URL(`/v1/orgs/${c.var.org}${request.path}`, c.req.url),
          {
            method: request.method,
            headers: {
              "content-type": "application/json",
              authorization: c.req.header("authorization") ?? "",
              "x-api-key": c.req.header("x-api-key") ?? "",
            },
            body: request.body ?? null,
          },
        ),
        c.env,
        c.executionCtx,
      ),
  );
  return answer ? c.json(answer) : c.body(null, 202);
});
orgApi.get("/mcp", (c) => c.body(null, 405, { allow: "POST" }));

const v1 = new OpenAPIHono<{ Bindings: Env }>();
v1.route("/orgs/:org", orgApi);
v1.route("/me", meRoutes);
v1.route("/", mcpCallback);
v1.route("/", githubCallbacks);
v1.route("/", autumnWebhook);
v1.doc31("/openapi.json", (c) => ({ ...OPENAPI, tags: [trainingTag(c.env)] }));
app.route("/v1", v1);

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    // Every minute: re-send outbox rows a failed queue send left behind.
    // Every minute, too: report metered usage to billing and close the awake
    // intervals of sandboxes gone silent, and warn about or apply moves down
    // to Free (our cloud only).
    if (controller.cron === "* * * * *") {
      ctx.waitUntil(sweepOutbox(env));
      ctx.waitUntil(reportUsage(env));
      ctx.waitUntil(closeSilentSandboxes(env));
      ctx.waitUntil(runPlanChanges(env, new Date(controller.scheduledTime)));
      return;
    }
    // 00:20 UTC: sign and store yesterday's audit chain for every
    // organization, forget expired idempotency keys, delete what is past each
    // organization's retention periods, collect custom sandbox layers no live
    // deployment names, and report yesterday's storage and, on the first,
    // last month's active seats.
    const now = new Date(controller.scheduledTime);
    ctx.waitUntil(collectSandboxLayers(env, now));
    ctx.waitUntil(anchorAll(env, now));
    ctx.waitUntil(deleteExpiredIdempotencyKeys(env));
    ctx.waitUntil(sweepRetention(env, now));
    ctx.waitUntil(reportDaily(env, now));
  },
  async queue(
    batch: MessageBatch<Job | OutboxMessage | LogRecord | OtelRetry>,
    env: Env,
  ) {
    if (batch.queue.startsWith("preprocess-logs-")) {
      // A failed store write retries the whole batch; a failed export
      // retries only the export.
      const bodies = batch.messages.map((m) => m.body as LogRecord | OtelRetry);
      const fresh = bodies.filter((b): b is LogRecord => !("otelRetry" in b));
      if (fresh.length) await ingestLogs(env, fresh);
      await exportLogs(env, [
        ...fresh.map((record) => ({ otelRetry: 0, record })),
        ...bodies.filter((b): b is OtelRetry => "otelRetry" in b),
      ]);
      batch.ackAll();
      return;
    }
    if (batch.queue.startsWith("preprocess-cases-")) {
      // A start that throws is retried by the queue.
      for (const message of batch.messages as Message<OutboxMessage>[]) {
        if (message.body.kind === "eval.start")
          await startQueuedEval(env, message.body);
        else await startQueuedCase(env, message.body);
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
} satisfies ExportedHandler<Env, Job | OutboxMessage | LogRecord>;
