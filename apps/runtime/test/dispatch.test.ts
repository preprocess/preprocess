import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { agentWorker, IN_FLIGHT_LIMIT, InFlight } from "../src/dispatch.ts";
import type { Deployment, NetworkRules } from "../src/env.ts";
import { deploy, setSecrets } from "./deploy.ts";
// Bundled by vitest.config.ts, as the deploy command uploads it.
import sampleAgent from "./dist/sample-agent.js?raw";

const call = (d: Deployment, tool: string, input: unknown) =>
  agentWorker(env, d, { exports })
    .fetch(`/tools/${tool}`, {
      method: "POST",
      body: JSON.stringify({ input, case: { id: "case_1" }, callId: "call_1" }),
    })
    .then((r) => r.json<{ output: Record<string, unknown> }>());

const deployment = async (
  deploymentId: string,
  secrets: Record<string, string> = {},
  network: NetworkRules = { allow: [], block: [] },
): Promise<Deployment> => {
  const ref = { organizationId: "org_d", agentId: "agt_stock", deploymentId };
  return { ...ref, ...(await deploy(ref, sampleAgent, secrets)), network };
};

describe("agent code as a Dynamic Worker", () => {
  it("sees a rotated secret on the next call, and a revoked one is gone", async () => {
    const d = await deployment("dep_rotate", { ERP_TOKEN: "first" });
    const lookup = () => call(d, "lookup_stock", { sku: "A1" });
    expect((await lookup()).output).toMatchObject({ tokenLength: 5 });
    await setSecrets(d, { ERP_TOKEN: "rotated-value" });
    expect((await lookup()).output).toMatchObject({ tokenLength: 13 });
    await setSecrets(d, {});
    expect((await lookup()).output).toMatchObject({
      tokenLength: 0,
      authorization: "Bearer undefined",
    });
  });

  it("applies the rules each call carries, not the rules it loaded with", async () => {
    const blocked = await deployment(
      "dep_rules",
      {},
      {
        allow: [],
        block: ["example.com"],
      },
    );
    const open = { ...blocked, network: { allow: [], block: [] } };
    const fetchPage = (d: Deployment) =>
      call(d, "carrier_status", { url: "https://example.com/track" });
    expect((await fetchPage(blocked)).output).toMatchObject({ status: 403 });
    expect((await fetchPage(open)).output).toMatchObject({
      status: 200,
      body: "reached example.com",
    });
    expect((await fetchPage(blocked)).output).toMatchObject({ status: 403 });
  });

  it("refuses a bundle that does not match the hash the deploy recorded", async () => {
    const d = await deployment("dep_tampered");
    await env.BUNDLES.put(
      "org_d/agt_stock/dep_tampered.json",
      JSON.stringify({
        mainModule: "agent.js",
        modules: {
          "agent.js": "export default { fetch: () => new Response('evil') }",
        },
      }),
    );
    const error = await call(d, "lookup_stock", { sku: "A1" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(String(error)).toMatch(/does not match its hash/);
  });
});

describe("the in-flight guard", () => {
  const peak = async (limit: number, ids: string[]) => {
    const guard = new InFlight(limit);
    const running = new Set<string>();
    let most = 0;
    await Promise.all(
      ids.map((id) =>
        guard.run(id, async () => {
          running.add(id);
          most = Math.max(most, running.size);
          await new Promise((r) => setTimeout(r, 20));
          running.delete(id);
        }),
      ),
    );
    return most;
  };

  it("holds a Durable Object to Cloudflare's limit of distinct Dynamic Workers", async () => {
    const ids = Array.from({ length: 14 }, (_, i) => `dep_${i}`);
    expect(await peak(IN_FLIGHT_LIMIT.durableObject, ids)).toBe(10);
    expect(await peak(IN_FLIGHT_LIMIT.request, ids)).toBe(4);
  });

  it("counts calls to one Dynamic Worker once", async () => {
    const ids = ["a", "a", "a", "b", "b", "c", "d"];
    const guard = new InFlight(4);
    const started: string[] = [];
    await Promise.all(
      ids.map((id) =>
        guard.run(id, async () => {
          started.push(id);
          await new Promise((r) => setTimeout(r, 20));
        }),
      ),
    );
    expect(started.slice(0, ids.length)).toEqual(ids);
  });
});
