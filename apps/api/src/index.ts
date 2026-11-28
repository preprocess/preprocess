import {
  initLogs,
  logFailure,
  routeOf,
  sendProductEvents,
  trafficOf,
} from "@preprocess/logs";
import type { LogRecord, ProductProperties } from "@preprocess/logs";
import { ModelError } from "@preprocess/models/client";
import { evlog, type EvlogVariables } from "evlog/hono";
import { OpenAPIHono } from "@hono/zod-openapi";
import { runMode } from "@preprocess/runmode";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";

import {
  identifyAllOrganizations,
  isProductMessage,
  trackEvent,
  type ProductMessage,
} from "./analytics.ts";
import { anchorAll, publicKeys } from "./audit-anchor.ts";
import { reportDaily, reportUsage } from "./billing.ts";
import { runPlanChanges } from "./plan-change.ts";
import { closeSilentSandboxes } from "./sandbox.ts";
import { collectSandboxLayers } from "./sandbox-layers.ts";
import { handleAuthRequest } from "./auth.ts";
import { invitationPreview } from "./invitation-preview.ts";
import { orgCaller } from "./caller.ts";
import { authRateLimit, orgRateLimit } from "./rate-limit.ts";
import type { OrgVariables } from "./caller.ts";
import { startQueuedCase } from "./cases.ts";
import type { Env, Job } from "./env.ts";
import { reportDeadLetters } from "./dead-letters.ts";
import { deleteExpiredIdempotencyKeys } from "./idempotency.ts";
import { heartbeat } from "./heartbeat.ts";
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
import { scimRoutes } from "./routes/scim.ts";
import { organizationRoutes } from "./routes/organization.ts";
import { ssoRoutes } from "./routes/sso.ts";
import { githubCallbacks, githubRoutes } from "./routes/github.ts";
import { mcpCallback, mcpRoutes } from "./routes/mcp.ts";
import { secretRoutes } from "./routes/secrets.ts";
import { guardrailRoutes } from "./routes/guardrails.ts";
import { sandboxRoutes } from "./routes/sandboxes.ts";
import { scheduleRoutes } from "./routes/schedules.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { spendingRoutes } from "./routes/spending.ts";
import { retentionRoutes } from "./routes/retention.ts";
import { licenseRoutes } from "./routes/license.ts";
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
import { modelRoutes } from "./routes/models.ts";
import { captureRoutes } from "./routes/capture.ts";
import { datasetRoutes } from "./routes/datasets.ts";
import { meRoutes } from "./routes/me.ts";
import { buildTools, handleMcp, type Tool } from "./mcp-server.ts";

export { BuildQueue } from "./builds.ts";
export { Counter } from "./counter.ts";
export { RateLimiter } from "./rate-limit.ts";
export { Scheduler } from "./scheduler.ts";
export { McpService } from "./mcp.ts";
export { Platform } from "./platform.ts";

const OPENAPI = {
  openapi: "3.1.0",
  info: { title: "Preprocess API", version: "1" },
};

const app = new Hono<{ Bindings: Env } & EvlogVariables>();

// The route a request matched, as a template, else its path with ids taken
// out (routeOf).
const routeTemplate = (c: Context) => {
  const route = routePath(c, -1);
  return route && route !== "*" && !route.endsWith("/*")
    ? route
    : routeOf(c.req.path);
};

// One wide event per request (design doc 09). The run log keeps the ones an
// organization's caller made; PostHog, where configured, gets every request's
// route, status and duration, and its errors.
app.use(async (c, next) => {
  initLogs("api", (records) => sendLogs(c.env, records), c.env);
  await next();
});
app.use(evlog());
app.use(async (c, next) => {
  await next();
  c.get("log").set({
    route: routeTemplate(c),
    traffic: trafficOf(c.req.path, c.req.header("user-agent") ?? null),
  });
});
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
app.on(
  ["GET", "POST"],
  "/api/auth/*",
  async (c) =>
    (await authRateLimit(c.env, c.req.raw, (p) =>
      c.executionCtx.waitUntil(p),
    )) ?? handleAuthRequest(c.env, c.req.raw),
);
// Directory sync (scim.ts): SCIM also replaces, patches and deletes.
app.on(["PUT", "PATCH", "DELETE"], "/api/auth/scim/v2/*", (c) =>
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
// The request's wide event joins the organization's run log only once the
// caller is known to belong to it.
orgApi.use(orgCaller);
// Its failed requests are api_error product events (analytics.ts) too, on
// the organization's group, so reliability reads per customer: every server
// error, and one client error in ten carrying weight 10. A rate limit's 429
// is rate_limited instead.
const CLIENT_ERROR_WEIGHT = 10;
orgApi.use(async (c, next) => {
  c.get("log").set({ organizationId: c.var.org });
  await next();
  const { status } = c.res;
  if (status < 400 || status === 429) return;
  const server = status >= 500;
  if (!server && Math.random() * CLIENT_ERROR_WEIGHT >= 1) return;
  const { caller } = c.var;
  c.executionCtx.waitUntil(
    trackEvent(
      c.env,
      "api_error",
      c.var.org,
      caller.type === "person" ? caller.userId : null,
      {
        route: routeTemplate(c).toLowerCase(),
        method:
          c.req.method.toLowerCase() as ProductProperties<"api_error">["method"],
        status,
        status_class: server ? "server_error" : "client_error",
        caller: caller.type,
        weight: server ? 1 : CLIENT_ERROR_WEIGHT,
      },
    ),
  );
});
orgApi.use(orgRateLimit);
orgApi.route("/", organizationRoutes);
orgApi.route("/", ssoRoutes);
orgApi.route("/", groupRoutes);
orgApi.route("/", auditRoutes);
orgApi.route("/", scimRoutes);
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
orgApi.route("/", licenseRoutes);
orgApi.route("/", scheduleRoutes);
orgApi.route("/", webhookRoutes);
orgApi.route("/", inboxRoutes);
orgApi.route("/", logRoutes);
orgApi.route("/", otelRoutes);
orgApi.route("/", evalRoutes);
orgApi.route("/", memoryRoutes);
orgApi.route("/", trainingRoutes);
orgApi.route("/", modelRoutes);
orgApi.route("/", captureRoutes);
orgApi.route("/", datasetRoutes);

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
              "x-preprocess-client": "mcp",
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

// A cron task or queue batch that fails is an error event, like a failed
// request.
const watch = (
  ctx: ExecutionContext,
  operation: string,
  promise: Promise<unknown>,
) =>
  ctx.waitUntil(
    promise.catch((error: unknown) => {
      console.error(error);
      logFailure(operation, error, (p) => ctx.waitUntil(p));
    }),
  );

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    initLogs("api", (records) => sendLogs(env, records), env);
    // Every minute: re-send outbox rows a failed queue send left behind.
    // Every minute, too: report metered usage to billing, close the awake
    // intervals of sandboxes gone silent, report dead-letter queues that hold
    // messages, and warn about or apply moves down to Free (our cloud only).
    if (controller.cron === "* * * * *") {
      watch(
        ctx,
        "cron.outbox",
        sweepOutbox(env).then(() => heartbeat(env, "tick")),
      );
      watch(ctx, "cron.usage", reportUsage(env));
      watch(ctx, "cron.sandboxes", closeSilentSandboxes(env));
      watch(ctx, "cron.dead-letters", reportDeadLetters(env));
      watch(
        ctx,
        "cron.plan-changes",
        runPlanChanges(env, new Date(controller.scheduledTime)),
      );
      return;
    }
    // 00:20 UTC: sign and store yesterday's audit chain for every
    // organization, forget expired idempotency keys, delete what is past each
    // organization's retention periods, collect custom sandbox layers no live
    // deployment names, and report yesterday's storage and, on the first,
    // last month's active seats.
    const now = new Date(controller.scheduledTime);
    watch(ctx, "cron.sandbox-layers", collectSandboxLayers(env, now));
    watch(ctx, "cron.audit-anchor", anchorAll(env, now));
    watch(ctx, "cron.analytics-groups", identifyAllOrganizations(env));
    watch(ctx, "cron.idempotency", deleteExpiredIdempotencyKeys(env));
    watch(ctx, "cron.retention", sweepRetention(env, now));
    watch(ctx, "cron.daily-usage", reportDaily(env, now));
  },
  async queue(
    batch: MessageBatch<
      Job | OutboxMessage | LogRecord | OtelRetry | ProductMessage
    >,
    env: Env,
    ctx: ExecutionContext,
  ) {
    initLogs("api", (records) => sendLogs(env, records), env);
    try {
      await consume(batch, env, ctx);
    } catch (error) {
      logFailure(`queue.${queueKind(batch.queue)}`, error, (p) =>
        ctx.waitUntil(p),
      );
      throw error;
    }
  },
} satisfies ExportedHandler<Env, Job | OutboxMessage | LogRecord>;

// preprocess-<kind>-<stage> to <kind>.
const queueKind = (queue: string) => queue.split("-")[1] ?? queue;

const consume = async (
  batch: MessageBatch<
    Job | OutboxMessage | LogRecord | OtelRetry | ProductMessage
  >,
  env: Env,
  ctx: ExecutionContext,
) => {
  if (batch.queue.startsWith("preprocess-logs-")) {
    // Product events (analytics.ts) go to PostHog first, each acked once
    // sent, so a failed send retries only those.
    const product = batch.messages.filter((m) => isProductMessage(m.body));
    if (product.length) {
      try {
        await sendProductEvents(
          env,
          product.map((m) => (m.body as ProductMessage).product),
        );
        for (const m of product) m.ack();
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "product.send_failed",
            error: String(error),
          }),
        );
        for (const m of product) m.retry({ delaySeconds: 30 });
      }
    }
    // A failed store write retries the whole batch; a failed export
    // retries only the export.
    const logs = batch.messages.filter((m) => !isProductMessage(m.body));
    const bodies = logs.map((m) => m.body as LogRecord | OtelRetry);
    const fresh = bodies.filter((b): b is LogRecord => !("otelRetry" in b));
    if (fresh.length) await ingestLogs(env, fresh);
    await exportLogs(env, [
      ...fresh.map((record) => ({ otelRetry: 0, record })),
      ...bodies.filter((b): b is OtelRetry => "otelRetry" in b),
    ]);
    for (const m of logs) m.ack();
    return;
  }
  if (batch.queue.startsWith("preprocess-cases-")) {
    // A start that throws is retried by the queue.
    for (const message of batch.messages as Message<OutboxMessage>[]) {
      if (message.body.kind === "eval.start")
        await startQueuedEval(env, message.body);
      else {
        await startQueuedCase(env, message.body);
        ctx.waitUntil(heartbeat(env, "case"));
      }
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
};
