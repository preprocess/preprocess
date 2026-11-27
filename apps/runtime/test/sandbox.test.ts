// Case sandboxes (spec 3 and 16a): the sandbox reports its awake intervals
// through SandboxMeter, which the API times and bills (apps/api/test/
// sandbox.test.ts covers sleep, destroy, crash and silence there); the case's
// close and the lifetime cap end the interval; the size guardrail holds at run
// time; and an eval case returns the source case's captured results without
// starting a sandbox.

import type { SandboxEvent } from "@preprocess/sandbox";
import { SandboxMeter } from "@preprocess/sandbox";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { CAPTURE_FORMAT, CAPTURE_VERSION, captureKey } from "../src/capture.ts";
import type { CaseView } from "../src/case-runtime.ts";
import type { CaseKey, StartCase } from "../src/env.ts";
import {
  layerBuilderName,
  layerKey,
  ownsLayer,
  type LayerJob,
} from "../src/layers.ts";
import { LIFETIME_MS, sandboxName } from "../src/sandbox.ts";
import { deploy } from "./deploy.ts";
// Bundled by vitest.config.ts, as the deploy command uploads it.
import mediumSandboxAgent from "./dist/medium-sandbox-agent.js?raw";
import sandboxAgent from "./dist/sandbox-agent.js?raw";

const runtime = (exports as unknown as { default: unknown }).default as {
  startCase(start: StartCase): Promise<CaseView>;
  getCase(c: CaseKey): Promise<CaseView>;
  queueSandboxLayer(
    job: LayerJob,
    d: { organizationId: string; agentId: string; deploymentId: string },
  ): Promise<void>;
  deleteSandboxLayer(organizationId: string, key: string): Promise<boolean>;
};
const platform = env.PLATFORM as unknown as {
  sandboxEvents(): Promise<SandboxEvent[]>;
  layerResults(): Promise<
    { deployment: { deploymentId: string }; result: { error?: string } }[]
  >;
};

const reported = async (key: CaseKey) =>
  (await platform.sandboxEvents()).filter((e) => e.caseId === key.caseId);

// A small sandbox whose interval is open, as a first sandbox call leaves it.
// Tests have no container, so every stop the sandbox finds is one it did not
// see: the API closes those at the last heartbeat.
const awake = (key: CaseKey, startedAt = Date.now(), requestedAt?: Date) =>
  runInDurableObject(
    env.SANDBOX_SMALL.getByName(sandboxName(key)),
    async (_, state) => {
      await state.storage.put("sandbox:startedAt", startedAt);
      await new SandboxMeter(state, env.PLATFORM).begin(
        {
          organizationId: key.organizationId,
          agent: key.agentId,
          caseId: key.caseId,
        },
        "case",
        "small",
        "start",
        requestedAt,
      );
    },
  );

describe("sandbox metering", () => {
  it("reports a start labelled with the case and its size", async () => {
    const key = {
      organizationId: "org_sbx",
      agentId: "agt_sbx",
      caseId: "case_label",
    };
    await awake(key);
    expect(await reported(key)).toEqual([
      expect.objectContaining({
        organizationId: "org_sbx",
        agent: "agt_sbx",
        caseId: "case_label",
        kind: "case",
        size: "small",
        seq: 1,
        type: "start",
      }),
    ]);
  });

  it("closes the interval at the alarm once the container is gone", async () => {
    const key = {
      organizationId: "org_sbx",
      agentId: "agt_sbx",
      caseId: "case_gone",
    };
    await awake(key);
    const stub = env.SANDBOX_SMALL.getByName(sandboxName(key));
    await runInDurableObject(stub, (sandbox) => sandbox.alarm());
    await runInDurableObject(stub, (sandbox) => sandbox.alarm());
    expect((await reported(key)).map((e) => [e.seq, e.type])).toEqual([
      [1, "start"],
      [1, "crash"],
    ]);
  });

  it("times the start when the container was asked to start, and a crash nobody saw at the last check that saw it running", async () => {
    const key = {
      organizationId: "org_sbx",
      agentId: "agt_sbx",
      caseId: "case_timed",
    };
    const requested = new Date(Date.now() - 1_000);
    await awake(key, Date.now(), requested);
    const stub = env.SANDBOX_SMALL.getByName(sandboxName(key));
    await runInDurableObject(stub, (sandbox) => sandbox.alarm());
    expect((await reported(key)).map((e) => [e.type, e.at])).toEqual([
      ["start", requested.toISOString()],
      ["crash", requested.toISOString()],
    ]);
  });

  it("ends a stop it saw at the moment it saw it", async () => {
    const key = {
      organizationId: "org_sbx",
      agentId: "agt_sbx",
      caseId: "case_seen",
    };
    await awake(key);
    const stub = env.SANDBOX_SMALL.getByName(sandboxName(key));
    const before = Date.now();
    await runInDurableObject(stub, (sandbox) =>
      (sandbox as unknown as { stopped(type: "sleep"): Promise<void> }).stopped(
        "sleep",
      ),
    );
    const stop = (await reported(key)).find((e) => e.type === "sleep");
    expect(Date.parse(stop!.at!)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(stop!.at!)).toBeLessThanOrEqual(Date.now());
  });

  it("does not take the stop its own destroy causes for a crash", async () => {
    const key = {
      organizationId: "org_sbx",
      agentId: "agt_sbx",
      caseId: "case_destroying",
    };
    await awake(key);
    type Watched = {
      destroying: boolean;
      stopped(type: "crash"): Promise<void>;
    };
    const stub = env.SANDBOX_SMALL.getByName(sandboxName(key));
    await runInDurableObject(stub, async (sandbox) => {
      const watched = sandbox as unknown as Watched;
      watched.destroying = true;
      await watched.stopped("crash");
    });
    expect((await reported(key)).map((e) => e.type)).toEqual(["start"]);
    await runInDurableObject(stub, async (sandbox) => {
      const watched = sandbox as unknown as Watched;
      watched.destroying = false;
      await watched.stopped("crash");
    });
    expect((await reported(key)).map((e) => e.type)).toEqual([
      "start",
      "crash",
    ]);
  });

  it("ends a sandbox at its lifetime cap", async () => {
    const key = {
      organizationId: "org_sbx",
      agentId: "agt_sbx",
      caseId: "case_lifetime",
    };
    await awake(key, Date.now() - LIFETIME_MS);
    await runInDurableObject(
      env.SANDBOX_SMALL.getByName(sandboxName(key)),
      async (sandbox, state) => {
        await sandbox.alarm();
        expect(await state.storage.get("sandbox:open")).toBeUndefined();
        expect(await state.storage.getAlarm()).toBeNull();
      },
    );
    expect((await reported(key)).at(-1)?.type).toBe("crash");
  });
});

const run = async (
  key: CaseKey,
  text: string,
  extra: Partial<StartCase> = {},
  module = sandboxAgent,
) => {
  const { bundleHash } = await deploy(
    {
      organizationId: key.organizationId,
      agentId: key.agentId,
      deploymentId: "dep_sbx",
    },
    module,
  );
  await runtime.startCase({
    ...key,
    deploymentId: "dep_sbx",
    bundleHash,
    network: { allow: [], block: [] },
    input: { text },
    ...extra,
  });
  for (let i = 0; i < 200; i++) {
    const view = await runtime.getCase(key);
    if (view.status !== "running") return view;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("case did not settle");
};

const results = (view: CaseView) =>
  view.capture
    .filter((e) => e.kind === "tool.result" && e.data.name === "sandbox_exec")
    .map((e) => e.data);

describe("sandbox tools in a case", () => {
  it("destroys the sandbox when the case closes", async () => {
    const key = {
      organizationId: "org_sbx",
      agentId: "agt_sbx",
      caseId: "case_close",
    };
    await awake(key);
    const view = await run(key, "Say hello.");
    expect(view.status).toBe("completed");
    // The close is reported just after the case settles.
    for (let i = 0; i < 40 && (await reported(key)).length < 2; i++)
      await new Promise((r) => setTimeout(r, 50));
    expect((await reported(key)).map((e) => [e.seq, e.type])).toEqual([
      [1, "start"],
      [1, "crash"],
    ]);
  });

  it("refuses a size past the organization's guardrail at run time", async () => {
    const view = await run(
      { organizationId: "org_capped", agentId: "agt_sbx", caseId: "case_cap" },
      "Add two and two in the sandbox.",
      {},
      mediumSandboxAgent,
    );
    expect(results(view)[0]).toMatchObject({
      isError: true,
      output: expect.stringContaining(
        "larger than the organization allows",
      ) as string,
    });
  });

  it("replays the source case's captured output in an eval, never running it", async () => {
    const source = {
      organizationId: "org_sbx",
      agentId: "agt_sbx",
      caseId: "case_source",
    };
    const input = { command: "python3 -c 'print(2 + 2)'" };
    const output = { exitCode: 0, stdout: "4\n", stderr: "" };
    await env.RUNS.put(
      captureKey(source),
      JSON.stringify({
        format: CAPTURE_FORMAT,
        version: CAPTURE_VERSION,
        ...source,
        deploymentId: "dep_sbx",
        sdkVersion: "0.1.0",
        model: "deepseek-v4.1-flash",
        status: "completed",
        usage: {
          input: 0,
          output: 0,
          costMicroUsd: 0,
          charges: { model: 0, decide: 0, ocr: 0 },
        },
        events: [
          {
            seq: 1,
            at: "",
            kind: "tool.call",
            data: { callId: "c1", name: "sandbox_exec", input },
          },
          {
            seq: 2,
            at: "",
            kind: "tool.result",
            data: {
              callId: "c1",
              name: "sandbox_exec",
              output,
              isError: false,
            },
          },
        ],
      }),
    );
    const evalKey = { ...source, caseId: "case_eval" };
    const view = await run(evalKey, "Add two and two in the sandbox.", {
      eval: {
        runId: "evr_1",
        sourceCaseId: source.caseId,
        captureKey: captureKey(source),
      },
    });
    expect(results(view)).toEqual([
      expect.objectContaining({ replayed: true, output, isError: false }),
    ]);
    // No sandbox was started for the eval case.
    expect(await reported(evalKey)).toEqual([]);

    // The same call outside an eval runs for real: here, where the runtime
    // has no containers, it fails, so the eval's "4" came only from capture.
    const live = await run(
      { ...source, caseId: "case_live" },
      "Add two and two in the sandbox.",
    );
    expect(results(live)[0]).toMatchObject({
      isError: true,
      output: expect.stringContaining(
        "Sandboxes are not available here",
      ) as string,
    });
  });
});

describe("custom environment layers", () => {
  const setup = {
    packages: { apt: ["jq"], pip: [], npm: [] },
    run: ["echo ok"],
    files: { "a.txt": "a" },
    env: { A: "1" },
  };

  it("are keyed by organization, preset image and setup, in any key order", async () => {
    const key = await layerKey("org_a", "img@sha256:1", setup);
    expect(key).toMatch(/^org\/org_a\/layers\/[0-9a-f]{64}$/);
    expect(ownsLayer("org_a", key)).toBe(true);
    expect(ownsLayer("org_b", key)).toBe(false);
    expect(
      await layerKey("org_a", "img@sha256:1", {
        env: { A: "1" },
        files: { "a.txt": "a" },
        run: ["echo ok"],
        packages: { npm: [], pip: [], apt: ["jq"] },
      }),
    ).toBe(key);
    expect(await layerKey("org_b", "img@sha256:1", setup)).toMatch(
      /^org\/org_b\/layers\//,
    );
    expect(await layerKey("org_a", "img@sha256:2", setup)).not.toBe(key);
  });

  it("are only deleted under the organization's own prefix", async () => {
    const mine = await layerKey("org_a", "img", setup);
    await env.BUNDLES.put(mine, "layer");
    expect(await runtime.deleteSandboxLayer("org_b", mine)).toBe(false);
    expect(await env.BUNDLES.head(mine)).not.toBeNull();
    expect(await runtime.deleteSandboxLayer("org_a", mine)).toBe(true);
    expect(await env.BUNDLES.head(mine)).toBeNull();
  });

  it("report a build that cannot run to every deployment waiting on it", async () => {
    const job: LayerJob = {
      organizationId: "org_layer",
      agentId: "agt_layer",
      preset: "python",
      setup,
      network: { allow: [], block: [] },
    };
    const d = { organizationId: "org_layer", agentId: "agt_layer" };
    await runtime.queueSandboxLayer(job, { ...d, deploymentId: "dep_1" });
    await runtime.queueSandboxLayer(job, { ...d, deploymentId: "dep_2" });
    const builder = env.SANDBOX_LARGE.getByName(await layerBuilderName(job));
    await runDurableObjectAlarm(builder);
    const reported = async () =>
      (await platform.layerResults()).filter((r) =>
        ["dep_1", "dep_2"].includes(r.deployment.deploymentId),
      );
    for (let i = 0; i < 40 && (await reported()).length < 2; i++)
      await new Promise((r) => setTimeout(r, 50));
    const results = await reported();
    expect(results.map((r) => r.deployment.deploymentId).sort()).toEqual([
      "dep_1",
      "dep_2",
    ]);
    expect(results[0]!.result.error).toMatch(/Sandboxes are not available/);
  });
});
