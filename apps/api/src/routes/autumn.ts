// Autumn's webhooks (PRE-128): auto-reload failures and successes, which
// Autumn's customer read doesn't carry. Unauthenticated and verified by its
// Svix signature. Only our cloud with AUTUMN_WEBHOOK_SECRET set takes them;
// anywhere else the route answers 404 and does nothing.

import { runMode } from "@preprocess/runmode";
import { Hono } from "hono";

import {
  recordAutumnEvent,
  verifySvix,
  type AutumnEvent,
} from "../auto-reload.ts";
import type { Env } from "../env.ts";

export const autumnWebhook = new Hono<{ Bindings: Env }>().post(
  "/autumn/webhook",
  async (c) => {
    const secret = c.env.AUTUMN_WEBHOOK_SECRET;
    if (runMode(c.env).kind !== "cloud" || !secret)
      return c.json({ error: "not_found" }, 404);
    const body = await c.req.text();
    if (!(await verifySvix(secret, c.req.raw.headers, body)))
      return c.json({ error: "invalid_signature" }, 401);
    let event: AutumnEvent;
    try {
      event = JSON.parse(body) as AutumnEvent;
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    await recordAutumnEvent(c.env, event);
    return c.body(null, 204);
  },
);
