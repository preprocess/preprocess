// Dead-letter depth: nothing sent while every queue is empty, one PostHog
// event per queue that holds messages, and nothing without a PostHog key.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reportDeadLetters } from "../src/dead-letters.ts";
import type { Env } from "../src/env.ts";

const queue = (backlogCount: number) =>
  ({
    metrics: () =>
      Promise.resolve({
        backlogCount,
        backlogBytes: backlogCount * 100,
        ...(backlogCount && {
          oldestMessageTimestamp: new Date("2026-11-28T09:00:00Z"),
        }),
      }),
  }) as unknown as Queue;

const env = (extra: Partial<Env>) =>
  ({
    STAGE: "production",
    JOBS_DLQ: queue(0),
    CASES_DLQ: queue(2),
    WEBHOOKS_DLQ: queue(0),
    EMAILS_DLQ: queue(0),
    LOGS_DLQ: queue(0),
    ...extra,
  }) as Env;

describe("reportDeadLetters", () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response('{"status":"Ok"}', { status: 200 })),
  );

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends one event per queue that holds messages", async () => {
    const held = await reportDeadLetters(env({ POSTHOG_KEY: "phc_test" }));
    expect(held).toEqual([
      { queue: "cases", depth: 2, oldestMessageAt: "2026-11-28T09:00:00.000Z" },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://us.i.posthog.com/batch/");
    const body = JSON.parse(init.body as string) as {
      api_key: string;
      batch: { event: string; properties: Record<string, unknown> }[];
    };
    expect(body.api_key).toBe("phc_test");
    expect(body.batch).toHaveLength(1);
    expect(body.batch[0]).toMatchObject({
      event: "queue_dead_letters",
      properties: {
        service: "api",
        stage: "production",
        queue: "cases",
        depth: 2,
      },
    });
  });

  it("sends nothing while every queue is empty", async () => {
    const held = await reportDeadLetters(
      env({ POSTHOG_KEY: "phc_test", CASES_DLQ: queue(0) }),
    );
    expect(held).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing without a PostHog key, as on previews", async () => {
    const held = await reportDeadLetters(env({}));
    expect(held).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips queues a stage does not bind, as in local development", async () => {
    expect(await reportDeadLetters({ STAGE: "development" } as Env)).toEqual(
      [],
    );
  });
});
