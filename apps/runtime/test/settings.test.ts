import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { CaseView } from "../src/case-runtime.ts";
import type { CaseKey, Settings, StartCase } from "../src/env.ts";
import { deploy } from "./deploy.ts";
// Bundled by vitest.config.ts, as the deploy command uploads it.
import sampleAgent from "./dist/sample-agent.js?raw";

const runtime = (exports as unknown as { default: unknown }).default as {
  startCase(start: StartCase): Promise<CaseView>;
  getCase(c: CaseKey): Promise<CaseView>;
};

const settle = async (c: CaseKey) => {
  for (let i = 0; i < 100; i++) {
    const view = await runtime.getCase(c);
    if (view.status !== "running") return view;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("case did not settle");
};

const run = async (
  organizationId: string,
  settings?: Settings,
  files?: StartCase["input"]["files"],
) => {
  const { bundleHash } = await deploy(
    { organizationId, agentId: "agt_stock", deploymentId: "dep_1" },
    sampleAgent,
    { ERP_TOKEN: "erp-test" },
  );
  const key = { organizationId, agentId: "agt_stock", caseId: "case_1" };
  await runtime.startCase({
    ...key,
    deploymentId: "dep_1",
    bundleHash,
    network: { allow: [], block: [] },
    input: {
      text: "Check stock for SKU A1 and its carrier status.",
      ...(files && { files }),
    },
    ...(settings && { settings }),
  });
  return settle(key);
};

const started = (view: CaseView) =>
  view.capture.find((e) => e.kind === "case.started")!.data as {
    model: string;
    reasoning: string;
  };

const requested = (view: CaseView) =>
  view.capture
    .filter((e) => e.kind === "model.request")
    .map((e) => (e.data as { model: string }).model);

describe("effective settings", () => {
  it("apply the platform's model and reasoning over the code's", async () => {
    const view = await run("org_settings", {
      model: "kimi-k3.1-pro",
      reasoning: "high",
      ocr: false,
      timeoutSeconds: null,
      toolRetries: null,
      sandboxImage: null,
      evals: { onPush: false },
      schedules: {},
    });
    expect(view.status).toBe("completed");
    expect(started(view)).toMatchObject({
      model: "kimi-k3.1-pro",
      reasoning: "high",
    });
    expect(new Set(requested(view))).toEqual(new Set(["kimi-k3.1-pro"]));
  });

  it("switch OCR on for an agent whose code leaves it off", async () => {
    const view = await run(
      "org_ocr",
      {
        model: "inkling-2-small",
        reasoning: "medium",
        ocr: true,
        timeoutSeconds: null,
        toolRetries: null,
        sandboxImage: null,
        evals: { onPush: false },
        schedules: {},
      },
      [{ id: "file_1", name: "packing-slip.png", contentType: "image/png" }],
    );
    // The test platform has no OCR, so the attempt is recorded as failed.
    expect(view.capture.filter((e) => e.kind === "ocr")).toMatchObject([
      { data: { fileId: "file_1" } },
    ]);
  });

  it("leave the code's values when the platform sends none", async () => {
    const view = await run("org_no_settings");
    expect(view.status).toBe("completed");
    expect(started(view).model).not.toBe("kimi-k3.1-pro");
  });
});
