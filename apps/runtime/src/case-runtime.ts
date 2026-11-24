import { DurableObject } from "cloudflare:workers";
import {
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  section,
} from "@earendil-works/pi-durable";
import type { Manifest, ToolResult } from "@preprocess/sdk/protocol";
import { PROTOCOL } from "@preprocess/sdk/protocol";
import { PiHarness, type PiOperationResult } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";

import {
  CAPTURE_FORMAT,
  CAPTURE_VERSION,
  captureKey,
  type CaptureEvent,
  type RunCapture,
  type Usage,
} from "./capture.ts";
import { agentWorker } from "./dispatch.ts";
import type { Deployment, Env, StartCase } from "./env.ts";
import { openModels, PROVIDER } from "./models.ts";

export type CaseStatus = "running" | "completed" | "failed";

export type CaseView = {
  caseId: string;
  status: CaseStatus;
  answer?: string;
  reason?: string;
  usage: Usage;
  capture: CaptureEvent[];
  captureKey: string;
};

type Meta = StartCase & {
  status: CaseStatus;
  manifest: Manifest;
  answer?: string;
  reason?: string;
};

const MAX_TURNS = 24;

// One Pi Durable runtime per organization, agent and case (spec 15), named
// "<org>:<agent>:<case>". Pi runs the model loop here, in our Worker; the
// agent's code is dispatched statelessly for its manifest and each tool call
// (layout B, PRE-28). This Worker has no secrets: values reach only the
// agent's code, and the SDK redacts them from what comes back.
export class CaseRuntime extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS case_meta (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL);
       CREATE TABLE IF NOT EXISTS capture (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);`,
    );
    if (this.meta()?.status === "running") ctx.waitUntil(this.watch());
  }

  private meta(): Meta | null {
    const row = this.ctx.storage.sql
      .exec<{ body: string }>("SELECT body FROM case_meta WHERE id = 1")
      .toArray()[0];
    return row ? (JSON.parse(row.body) as Meta) : null;
  }

  private save(meta: Meta) {
    this.ctx.storage.sql.exec(
      "INSERT INTO case_meta (id, body) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body",
      JSON.stringify(meta),
    );
  }

  private record(kind: CaptureEvent["kind"], data: Record<string, unknown>) {
    this.ctx.storage.sql.exec(
      "INSERT INTO capture (at, kind, data) VALUES (?, ?, ?)",
      new Date().toISOString(),
      kind,
      JSON.stringify(data),
    );
  }

  private events(): CaptureEvent[] {
    return this.ctx.storage.sql
      .exec<{
        seq: number;
        at: string;
        kind: CaptureEvent["kind"];
        data: string;
      }>("SELECT seq, at, kind, data FROM capture ORDER BY seq")
      .toArray()
      .map((row) => ({
        ...row,
        data: JSON.parse(row.data) as CaptureEvent["data"],
      }));
  }

  private usage(events: CaptureEvent[]): Usage {
    return events
      .filter((e) => e.kind === "model.response")
      .reduce<Usage>(
        (total, e) => {
          const usage = (e.data.usage ?? {}) as {
            input?: number;
            output?: number;
          };
          return {
            input: total.input + (usage.input ?? 0),
            output: total.output + (usage.output ?? 0),
            costMicroUsd: total.costMicroUsd,
          };
        },
        { input: 0, output: 0, costMicroUsd: 0 },
      );
  }

  private expectName(start: Deployment & { caseId: string }) {
    const expected = `${start.organizationId}:${start.agentId}:${start.caseId}`;
    if (this.ctx.id.name !== expected)
      throw new Error(
        `case runtime ${this.ctx.id.name ?? "?"} cannot serve ${expected}`,
      );
  }

  harness = new PiHarness({
    harness: ({ storage, context, onWake }) => {
      const meta = this.meta();
      if (!meta) throw new Error("case has not started");
      const worker = agentWorker(this.env, meta);
      const tools = meta.manifest.tools.map((tool) =>
        defineTool({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          replay: tool.sideEffects ? "unsafe" : "safe",
          execute: async (input, api) => {
            const callId = String(api.taskId);
            this.record("tool.call", { callId, name: tool.name, input });
            const started = Date.now();
            const response = await worker.fetch(`/tools/${tool.name}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                input,
                case: { id: meta.caseId },
                callId,
              }),
            });
            const result: ToolResult = response.ok
              ? await response.json<ToolResult>()
              : {
                  output: `agent Worker answered ${response.status}`,
                  isError: true,
                };
            this.record("tool.result", {
              callId,
              name: tool.name,
              ms: Date.now() - started,
              ...result,
            });
            const text =
              typeof result.output === "string"
                ? result.output
                : JSON.stringify(result.output);
            return {
              output: [{ type: "text", text }],
              isError: result.isError,
            };
          },
        }),
      );
      const registry = createRegistry();
      registry.install(
        defineExtension({
          name: "agent",
          sections: [
            section("agent", () => meta.manifest.instructions, { tag: false }),
          ],
          tools,
        }),
      );
      let turn = 0;
      const models = openModels(
        this.env,
        (fn) => (model, modelContext, options) => {
          const current = ++turn;
          const started = Date.now();
          this.record("model.request", {
            turn: current,
            model: model.id,
            context: modelContext,
          });
          const events = fn(model, modelContext, options);
          void events.result().then(
            (message) =>
              this.record("model.response", {
                turn: current,
                ms: Date.now() - started,
                stopReason: message.stopReason,
                usage: message.usage,
                message,
              }),
            (error: unknown) =>
              this.record("model.error", {
                turn: current,
                ms: Date.now() - started,
                error: String(error),
              }),
          );
          return events;
        },
      );
      return Harness.open(storage, { models, registry, onWake }, context);
    },
    defaults: { maxTurns: MAX_TURNS },
  });

  lifecycle = Lifecycle.install(this).use(this.harness);

  async start(start: StartCase): Promise<CaseView> {
    this.expectName(start);
    if (this.meta()) return this.view();
    const response = await agentWorker(this.env, start).fetch("/manifest");
    if (!response.ok)
      throw new Error(
        `agent Worker ${start.script} answered ${response.status}`,
      );
    const manifest = await response.json<Manifest>();
    if (manifest.protocol !== PROTOCOL)
      throw new Error(
        `agent protocol ${String(manifest.protocol)} is not supported`,
      );
    this.save({ ...start, status: "running", manifest });
    this.record("case.started", {
      deploymentId: start.deploymentId,
      script: start.script,
      sdk: manifest.sdk,
      model: manifest.model,
      reasoning: manifest.reasoning,
      tools: manifest.tools.map((t) => t.name),
      input: start.input,
    });
    await this.harness.root({
      agent: { model: { provider: PROVIDER, modelId: manifest.model } },
    });
    await this.harness.submit(start.input.text, {
      operationId: `case:${start.caseId}`,
    });
    this.ctx.waitUntil(this.watch());
    return this.view();
  }

  // Waits for Pi to settle the case, then seals the capture. Re-armed by the
  // constructor after an eviction, so it runs in whichever instance sees the
  // end.
  private async watch() {
    const meta = this.meta();
    if (!meta) return;
    const result = await this.harness.wait(`case:${meta.caseId}`);
    await this.finish(result);
  }

  private async finish(result: PiOperationResult) {
    const meta = this.meta();
    if (!meta || meta.status !== "running") return;
    const done = result.status === "done";
    const next: Meta = done
      ? {
          ...meta,
          status: "completed",
          ...(result.text !== undefined && { answer: result.text }),
        }
      : { ...meta, status: "failed", reason: result.reason ?? "unanswered" };
    this.save(next);
    this.record(
      done ? "case.completed" : "case.failed",
      done ? { answer: next.answer ?? "" } : { reason: next.reason },
    );
    const events = this.events();
    const capture: RunCapture = {
      format: CAPTURE_FORMAT,
      version: CAPTURE_VERSION,
      organizationId: meta.organizationId,
      agentId: meta.agentId,
      deploymentId: meta.deploymentId,
      caseId: meta.caseId,
      sdkVersion: meta.manifest.sdk.version,
      model: meta.manifest.model,
      status: next.status as RunCapture["status"],
      usage: this.usage(events),
      events,
    };
    await this.env.RUNS.put(captureKey(meta), JSON.stringify(capture), {
      httpMetadata: { contentType: "application/json" },
    });
  }

  view(): CaseView {
    const meta = this.meta();
    if (!meta) throw new Error("case has not started");
    const events = this.events();
    return {
      caseId: meta.caseId,
      status: meta.status,
      ...(meta.answer !== undefined && { answer: meta.answer }),
      ...(meta.reason !== undefined && { reason: meta.reason }),
      usage: this.usage(events),
      capture: events,
      captureKey: captureKey(meta),
    };
  }
}
