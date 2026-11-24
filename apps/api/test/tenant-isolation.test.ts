import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import worker from "../src/index.ts";

const increment = async (org: string) => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://api.test/orgs/${org}/counter`, { method: "POST" }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(response.status).toBe(200);
  const { count } = await response.json<{ count: number }>();
  return count;
};

describe("organization counters", () => {
  it("keep each organization's Durable Object state to itself", async () => {
    expect(await increment("org_a")).toBe(1);
    expect(await increment("org_a")).toBe(2);
    expect(await increment("org_b")).toBe(1);
  });
});
