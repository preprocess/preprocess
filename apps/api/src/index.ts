import { organizations } from "@preprocess/db";
import { ModelError } from "@preprocess/models/client";
import { decide, type DecideInput } from "@preprocess/models/decide";
import { modelEndpoint } from "@preprocess/models/endpoints";
import { ocrPage } from "@preprocess/models/ocr";
import { runMode } from "@preprocess/runmode";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { cors } from "hono/cors";
import pg from "pg";

import type { Env, Job } from "./env.ts";

export { Counter } from "./counter.ts";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.onError((error, c) => {
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

app.get("/orgs", async (c) => {
  const client = new pg.Client({ connectionString: c.env.DB.connectionString });
  await client.connect();
  try {
    return c.json(await drizzle(client).select().from(organizations));
  } finally {
    c.executionCtx.waitUntil(client.end());
  }
});

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
  // The queue consumer writes each job's result to R2 under its organization.
  async queue(batch: MessageBatch<Job>, env: Env) {
    for (const message of batch.messages) {
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
} satisfies ExportedHandler<Env, Job>;
