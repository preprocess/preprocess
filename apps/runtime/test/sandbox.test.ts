// Case sandboxes (spec 3 and 16a): the sandbox reports its awake intervals
// through SandboxMeter, which the API times and bills (apps/api/test/
// sandbox.test.ts covers sleep, destroy, crash and silence there); the case's
// close and the lifetime cap end the interval; the size guardrail holds at run
// time; and an eval case returns the source case's captured results without
// starting a sandbox.

import type { SandboxEvent } from "@preprocess/sandbox";
import { SandboxMeter } from "@preprocess/sandbox";
import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { CAPTURE_FORMAT, CAPTURE_VERSION, captureKey } from "../src/capture.ts";
import type { CaseView } from "../src/case-runtime.ts";
import type { CaseKey, Settings, StartCase } from "../src/env.ts";
import { LIFETIME_MS, sandboxName } from "../src/sandbox.ts";
import { deploy } from "./deploy.ts";
// Bundled by vitest.config.ts, as the deploy command uploads it.
import sandboxAgent from "./dist/sandbox-agent.js?raw";

const runtime = (exports as unknown as { default: unknown }).default as {
  startCase(start: StartCase): Promise<CaseView>;
  getCase(c: CaseKey): Promise<CaseView>;
};
const platform = env.PLATFORM as unknown as {
  sandboxEvents(): Promise<SandboxEvent[]>;
};

const reported = async (key: CaseKey) =>
  (await platform.sandboxEvents()).filter((e) => e.caseId === key.caseId);

// A small sandbox whose interval is open, as a first sandbox call leaves it.
// Tests have no container, so every stop the sandbox finds is one it did not
// see: the API closes those at the last heartbeat.
const awake = (key: CaseKey, startedAt = Date.now()) =>
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

const settings = (sandboxSize: string): Settings => ({
  model: "deepseek-v4.1-flash",
  reasoning: "medium",
  ocr: false,
  timeoutSeconds: null,
  toolRetries: null,
  sandboxImage: null,
  sandboxSize,
  evals: { onPush: false },
  schedules: {},
});

const run = async (
  key: CaseKey,
  text: string,
  extra: Partial<StartCase> = {},
) => {
  const { bundleHash } = await deploy(
    {
      organizationId: key.organizationId,
      agentId: key.agentId,
      deploymentId: "dep_sbx",
    },
    sandboxAgent,
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
      { settings: settings("medium") },
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
