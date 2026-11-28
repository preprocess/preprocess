// The status page heartbeat: off without both settings, the exact request
// with them, at most one case ping per 30 seconds, and never a throw.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env.ts";
import { heartbeat, resetHeartbeatThrottle } from "../src/heartbeat.ts";

const URL = "https://status.example.com/api/heartbeat";
const SECRET = "heartbeat-secret-do-not-leak";
const configured = {
  STAGE: "production",
  STATUS_HEARTBEAT_URL: URL,
  STATUS_HEARTBEAT_SECRET: SECRET,
} as Env;

describe("heartbeat", () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  );

  beforeEach(() => {
    resetHeartbeatThrottle();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends nothing unless both settings are set", async () => {
    await heartbeat({ STAGE: "selfhost" } as Env, "tick");
    await heartbeat({ STAGE: "x", STATUS_HEARTBEAT_URL: URL } as Env, "tick");
    await heartbeat(
      { STAGE: "x", STATUS_HEARTBEAT_SECRET: SECRET } as Env,
      "case",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the install and kind with the bearer secret", async () => {
    await heartbeat(configured, "tick");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      install: "production",
      kind: "tick",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends at most one case ping per 30 seconds, and every tick", async () => {
    await heartbeat(configured, "case");
    await heartbeat(configured, "case");
    await heartbeat(configured, "tick");
    await heartbeat(configured, "tick");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("swallows failures without logging the secret", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(heartbeat(configured, "tick")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 500 }));
    await expect(heartbeat(configured, "tick")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
  });
});
