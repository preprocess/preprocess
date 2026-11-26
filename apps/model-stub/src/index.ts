import { ocrRequest, systemOneRequest } from "@preprocess/models/contract";
import { ROUTES } from "@preprocess/models/endpoints";
import { Hono } from "hono";
import type { z } from "zod";

import { agentChat, type ChatRequest } from "./chat.ts";
import type { Env } from "./env.ts";
import { ocr } from "./ocr.ts";
import { answer } from "./systemone.ts";

// Stand-in for the model services in local development, previews and staging
// (design doc 07). It speaks the real contracts, validates as strictly as the
// real services, and answers deterministically from fixtures or a lexical
// score. No state, no database, no GPU.

const app = new Hono<{ Bindings: Env }>();

const serves = Object.values(ROUTES).map((route) => route.model);
const agentModels = new Set<unknown>(
  Object.entries(ROUTES)
    .filter(([name]) => name !== "decide" && name !== "ocr")
    .map(([, route]) => route.model),
);

app.get("/", (c) => c.json({ service: "model-stub", serves }));

app.use("/v1/*", async (c, next) => {
  const token = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
  if (!token)
    return c.json(
      { error: "Missing bearer token", error_type: "Authentication" },
      401,
    );

  const latency = Number(
    c.req.header("x-stub-latency-ms") ?? c.env.STUB_LATENCY_MS ?? 0,
  );
  if (latency > 0) await new Promise((r) => setTimeout(r, latency));

  const fail = c.req.header("x-stub-fail");
  if (fail === "timeout") {
    // Hold the request until the caller gives up.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 120_000);
      c.req.raw.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return c.json({ error: "Stub timeout", error_type: "Timeout" }, 504);
  }
  if (fail === "429")
    return c.json(
      { error: "Rate limited (stub)", error_type: "RateLimit" },
      429,
    );
  if (fail === "500" || fail === "503")
    return c.json(
      { error: `Simulated ${fail} (stub)`, error_type: "Server" },
      fail === "500" ? 500 : 503,
    );
  await next();
});

const body = async (request: Request) => {
  try {
    return { ok: true as const, json: await request.json() };
  } catch {
    return { ok: false as const };
  }
};

const validationError = (error: z.ZodError) =>
  error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message)
    .join("; ");

app.post("/v1/systemone", async (c) => {
  const parsed = await body(c.req.raw);
  if (!parsed.ok)
    return c.json(
      { error: "Request body must be JSON", error_type: "Validation" },
      400,
    );
  const request = systemOneRequest.safeParse(parsed.json);
  if (!request.success)
    return c.json(
      { error: validationError(request.error), error_type: "Validation" },
      422,
    );
  return c.json(answer(request.data));
});

app.post("/v1/ocr", async (c) => {
  const parsed = await body(c.req.raw);
  if (!parsed.ok) return c.json({ detail: "Request body must be JSON" }, 400);
  const request = ocrRequest.safeParse(parsed.json);
  if (!request.success)
    return c.json({ detail: validationError(request.error) }, 422);
  if (request.data.model !== ROUTES.ocr.model)
    return c.json({ detail: `Invalid model: ${request.data.model}` }, 400);
  return c.json(await ocr(request.data));
});

app.post("/v1/chat/completions", async (c) => {
  const parsed = await body(c.req.raw);
  if (!parsed.ok)
    return c.json({ error: { message: "Request body must be JSON" } }, 400);
  const model = (parsed.json as { model?: unknown } | null)?.model;
  if (!agentModels.has(model))
    return c.json(
      { error: { message: `The model \`${String(model)}\` does not exist.` } },
      404,
    );
  return agentChat(c, parsed.json as ChatRequest);
});

export default app;
