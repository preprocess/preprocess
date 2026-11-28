import type { Env } from "./env.ts";

// A fire-and-forget heartbeat to a status page: "tick" after the every-minute
// outbox sweep, "case" after a queued case starts. Off unless both
// STATUS_HEARTBEAT_URL and STATUS_HEARTBEAT_SECRET are set, so a self-hosted
// install sends nothing. Never throws and never retries.
export type HeartbeatKind = "tick" | "case";

export const CASE_HEARTBEAT_INTERVAL_MS = 30_000;
let lastCaseHeartbeat = 0;

export const heartbeat = async (env: Env, kind: HeartbeatKind) => {
  const url = env.STATUS_HEARTBEAT_URL;
  const secret = env.STATUS_HEARTBEAT_SECRET;
  if (!url || !secret) return;
  if (kind === "case") {
    const now = Date.now();
    if (now - lastCaseHeartbeat < CASE_HEARTBEAT_INTERVAL_MS) return;
    lastCaseHeartbeat = now;
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ install: env.STAGE, kind }),
      signal: AbortSignal.timeout(5000),
    });
    await response.body?.cancel();
    if (!response.ok)
      console.warn(
        JSON.stringify({
          event: "heartbeat.failed",
          kind,
          status: response.status,
        }),
      );
  } catch (error) {
    console.warn(
      JSON.stringify({ event: "heartbeat.failed", kind, error: String(error) }),
    );
  }
};

export const resetHeartbeatThrottle = () => {
  lastCaseHeartbeat = 0;
};
