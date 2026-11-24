import { ModelError } from "@preprocess/models/client";
import { decide, type DecideInput } from "@preprocess/models/decide";
import { modelEndpoint } from "@preprocess/models/endpoints";
import { ocrPage } from "@preprocess/models/ocr";
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
import { syncAgent } from "./deploy.ts";
import type { Env, Job, SecretSync } from "./env.ts";
import { agentRoutes } from "./routes/agents.ts";
import { auditRoutes } from "./routes/audit.ts";
import { devRoutes } from "./routes/dev.ts";
import { groupRoutes } from "./routes/groups.ts";
import { organizationRoutes } from "./routes/organization.ts";
import { mcpCallback, mcpRoutes } from "./routes/mcp.ts";
import { secretRoutes } from "./routes/secrets.ts";

export { Counter } from "./counter.ts";
export { McpService } from "./mcp.ts";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message || "error" }, error.status);
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

app.use("/dev/orgs/:org/*", orgCaller);
app.route("/dev/orgs/:org", devRoutes);

// Smoke routes for the model client until decide and OCR have their real
// callers (the runtime's decide tool and POST /v1/orgs/{org}/ocr).
app.post("/models/decide", async (c) =>
  c.json(
    await decide(
      modelEndpoint(c.env, "decide"),
      await c.req.json<DecideInput>(),
    ),
  ),
);

app.post("/models/ocr", async (c) =>
  c.json(
    await ocrPage(
      modelEndpoint(c.env, "ocr"),
      await c.req.json<{ image: string; grounding?: boolean }>(),
    ),
  ),
);

export default {
  fetch: app.fetch,
  // 00:20 UTC: sign and store yesterday's audit chain for every organization.
  scheduled(controller, env, ctx) {
    ctx.waitUntil(anchorAll(env, new Date(controller.scheduledTime)));
  },
  async queue(batch: MessageBatch<Job | SecretSync>, env: Env) {
    for (const message of batch.messages) {
      const body = message.body;
      if ("kind" in body) {
        try {
          await syncAgent(env, orgId(body.organizationId), body.agentId, {
            actorType: "platform",
            actorId: "secret-sync",
          });
          message.ack();
        } catch (error) {
          console.error(error);
          message.retry({ delaySeconds: Math.min(300, 2 ** message.attempts) });
        }
        continue;
      }
      // A job's result goes to R2 under its organization.
      const job = body;
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
} satisfies ExportedHandler<Env, Job | SecretSync>;
