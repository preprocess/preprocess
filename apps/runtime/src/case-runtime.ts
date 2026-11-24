import { DurableObject } from "cloudflare:workers";
import {
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  section,
} from "@earendil-works/pi-durable";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { initLogs, wideEvent } from "@preprocess/logs";
import { ModelError } from "@preprocess/models/client";
import { decide } from "@preprocess/models/decide";
import { modelEndpoint } from "@preprocess/models/endpoints";
import type { Effect, Manifest, ToolResult } from "@preprocess/sdk/protocol";
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
import type {
  CaseEvent,
  CaseStatus,
  Env,
  GroupRef,
  Settings,
  StartCase,
} from "./env.ts";
import { openModels, PROVIDER } from "./models.ts";
import { runLogEntry } from "./run-log.ts";
import { COMPACTION, largeSummaries } from "./summaries.ts";
import {
  type FieldView,
  SCHEMA_TABLES,
  SchemaState,
  type WriteResult,
} from "./schema-state.ts";

export type { CaseStatus };

export type ThreadMessage = {
  id: string;
  at: string;
  by: string;
  kind: "input" | "agent" | "person" | "tag" | "event";
  text: string;
  group: string | null;
};

export type CaseView = {
  caseId: string;
  status: CaseStatus;
  answer?: string;
  reason?: string;
  usage: Usage;
  capture: CaptureEvent[];
  captureKey: string;
};

export type CaseState = {
  caseId: string;
  status: CaseStatus;
  run: number;
  waitingOn: { group: string; reason: string | null } | null;
  reason: string | null;
  fields: FieldView[];
  checks: ReturnType<SchemaState["checks"]>;
  answers: Record<string, unknown>;
  thread: ThreadMessage[];
};

// What a person did since the agent's last run, as the API recorded it in
// review events. The agent is never told who.
export type ReviewNote = {
  kind: string;
  path: string | null;
  before: unknown;
  after: unknown;
};

type Meta = StartCase & {
  status: CaseStatus;
  manifest: Manifest;
  run: number;
  operation: string;
  waitingOn: { group: string; reason: string | null } | null;
  answer?: string;
  reason?: string;
  // Set until the agent first gets the case's input, which a halt at start
  // can delay to the Rerun that restarts it.
  unprompted?: true;
};

const MAX_TURNS = 24;

// The settings the platform resolved for this case apply over the code's
// values; a null keeps the code's value, or the runtime's own behavior.
const withSettings = (manifest: Manifest, settings?: Settings): Manifest => {
  if (!settings) return manifest;
  return {
    ...manifest,
    model: settings.model as Manifest["model"],
    reasoning: settings.reasoning as Manifest["reasoning"],
    ocr: settings.ocr,
    ...(settings.timeoutSeconds !== null && {
      timeoutSeconds: settings.timeoutSeconds,
    }),
    ...(settings.toolRetries !== null && {
      toolRetries: settings.toolRetries,
    }),
    ...(settings.sandboxImage !== null && {
      sandboxImage: settings.sandboxImage,
    }),
    evals: { ...manifest.evals, onPush: settings.evals.onPush },
    ...(manifest.schedules && {
      schedules: manifest.schedules.map((s) => ({
        ...s,
        previews: settings.schedules[s.name]?.previews ?? s.previews,
      })),
    }),
  };
};

const text = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

// One Pi Durable runtime per organization, agent and case (spec 15), named
// "<org>:<agent>:<case>". Pi runs the model loop here, in our Worker; the
// agent's code is dispatched statelessly for its manifest, each tool call and
// every schema evaluation (layout B, PRE-28). This Worker has no secrets:
// values reach only the agent's code, and the SDK redacts them from what
// comes back.
export class CaseRuntime extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS case_meta (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL);
       CREATE TABLE IF NOT EXISTS capture (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);
       CREATE TABLE IF NOT EXISTS thread (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, at TEXT NOT NULL, by TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, grp TEXT, run INTEGER NOT NULL);${SCHEMA_TABLES}`,
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

  private schema(meta: Meta) {
    return new SchemaState(
      this.ctx.storage.sql,
      meta.manifest,
      () => agentWorker(this.env, meta),
      meta.caseId,
    );
  }

  private record(kind: CaptureEvent["kind"], data: Record<string, unknown>) {
    this.ctx.storage.sql.exec(
      "INSERT INTO capture (at, kind, data) VALUES (?, ?, ?)",
      new Date().toISOString(),
      kind,
      JSON.stringify(data),
    );
    const entry = runLogEntry(kind, data);
    const meta = this.meta();
    if (!entry || !meta) return;
    // Run logs (design doc 09) leave through the API's Platform entrypoint.
    initLogs("runtime", (records) =>
      this.env.PLATFORM ? this.env.PLATFORM.logs(records) : Promise.resolve(),
    );
    const log = wideEvent(
      entry.kind,
      {
        organizationId: meta.organizationId,
        agentId: meta.agentId,
        deploymentId: meta.deploymentId,
        caseId: meta.caseId,
      },
      (promise) => this.ctx.waitUntil(promise),
    );
    log.set(entry.fields);
    if (entry.level !== "info") log.setLevel(entry.level);
    log.emit(entry.ms === undefined ? undefined : { _durationMs: entry.ms });
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

  private post(
    meta: Meta,
    by: string,
    kind: ThreadMessage["kind"],
    body: string,
    group: string | null = null,
  ) {
    const id = `tm_${crypto.randomUUID().replaceAll("-", "")}`;
    this.ctx.storage.sql.exec(
      "INSERT INTO thread (id, at, by, kind, text, grp, run) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      new Date().toISOString(),
      by,
      kind,
      body,
      group,
      meta.run,
    );
    return id;
  }

  private thread(): ThreadMessage[] {
    return this.ctx.storage.sql
      .exec<{
        id: string;
        at: string;
        by: string;
        kind: ThreadMessage["kind"];
        text: string;
        grp: string | null;
      }>("SELECT id, at, by, kind, text, grp FROM thread ORDER BY seq")
      .toArray()
      .map(({ grp, ...row }) => ({ ...row, group: grp }));
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

  private expectName(start: {
    organizationId: string;
    agentId: string;
    caseId: string;
  }) {
    const expected = `${start.organizationId}:${start.agentId}:${start.caseId}`;
    if (this.ctx.id.name !== expected)
      throw new Error(
        `case runtime ${this.ctx.id.name ?? "?"} cannot serve ${expected}`,
      );
  }

  // The groups this case may wait on or tag: those with access to the agent,
  // as the platform resolved them at start. Without that list (the runtime's
  // own tests), the groups the code declared.
  private groups(meta: Meta): GroupRef[] {
    return (
      meta.groups ??
      (meta.manifest.groups ?? []).map((slug) => ({
        id: slug,
        slug,
        name: slug,
        description: null,
        access: "operator" as const,
      }))
    );
  }

  private async report(
    meta: Meta,
    event: CaseEvent extends infer E
      ? E extends CaseEvent
        ? Omit<E, "organizationId" | "agentId" | "caseId">
        : never
      : never,
  ) {
    const full = {
      ...event,
      organizationId: meta.organizationId,
      agentId: meta.agentId,
      caseId: meta.caseId,
    };
    this.record("case.event", full);
    if (!this.env.PLATFORM) return;
    try {
      await this.env.PLATFORM.caseEvent(full);
    } catch (error) {
      this.record("platform.error", {
        event: event.type,
        error: String(error),
      });
    }
  }

  // The spending limit (design doc 04): asked before each metered model, OCR
  // or decide call. A refusal halts the case instead of making the call, and
  // only Rerun restarts it. A halt fires no webhook.
  private async overLimit() {
    const meta = this.meta()!;
    if (meta.status === "halted") return true;
    if (!this.env.PLATFORM) return false;
    const verdict = await this.env.PLATFORM.spendGate(meta.organizationId);
    if (verdict === "ok") return false;
    const next: Meta = {
      ...meta,
      status: "halted",
      waitingOn: null,
      reason: verdict,
    };
    this.save(next);
    this.record("case.halted", { reason: verdict });
    this.post(
      next,
      "platform",
      "event",
      "Halted: the organization reached its monthly spending limit",
    );
    await this.report(next, {
      type: "status",
      status: "halted",
      waitingOn: null,
      reason: null,
      answers: null,
      error: null,
      haltReason: verdict,
    });
    return true;
  }

  private applyEffect(meta: Meta, effect: Effect): string | null {
    const group = this.groups(meta).find((g) => g.slug === effect.group);
    if (!group) return `group ${effect.group} has no access to this agent`;
    if (effect.type === "wait") {
      this.save({
        ...meta,
        waitingOn: { group: group.slug, reason: effect.reason },
      });
      this.record("case.wait", { group: group.slug, reason: effect.reason });
      return null;
    }
    const messageId = this.post(
      meta,
      "agent",
      "tag",
      effect.message,
      group.slug,
    );
    this.ctx.waitUntil(
      this.report(meta, {
        type: "mention",
        group: group.slug,
        messageId,
        by: "agent",
        message: effect.message,
      }),
    );
    return null;
  }

  private platformTools(meta: Meta) {
    const schema = this.schema(meta);
    const result = (value: unknown, isError = false) => ({
      output: [{ type: "text" as const, text: text(value) }],
      isError,
    });
    const groupTools = [
      defineTool({
        name: "groups_list",
        description:
          "The groups of people with access to this agent. Wait on or tag a group by its slug; people are never named.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        replay: "safe",
        execute: () =>
          Promise.resolve(
            result(
              this.groups(this.meta()!).map(
                ({ slug, name, description, access }) => ({
                  slug,
                  name,
                  description,
                  access,
                }),
              ),
            ),
          ),
      }),
      defineTool({
        name: "tag_group",
        description:
          "Post a message in the case thread that tags a group; its members are notified.",
        parameters: {
          type: "object",
          properties: {
            group: { type: "string" },
            message: { type: "string" },
          },
          required: ["group", "message"],
          additionalProperties: false,
        },
        execute: (input: { group: string; message: string }) => {
          const problem = this.applyEffect(this.meta()!, {
            type: "tag",
            group: input.group,
            message: input.message,
          });
          return Promise.resolve(result(problem ?? "tagged", problem !== null));
        },
      }),
    ];
    if (!schema.enabled) return groupTools;

    const pathsParam = {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" } } },
      required: ["paths"],
      additionalProperties: false,
    };
    return [
      ...groupTools,
      defineTool({
        name: "schema_overview",
        description:
          "The whole output schema in compact lines: each field's status, value, visibility, staleness and failing checks.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        replay: "safe",
        execute: () =>
          Promise.resolve(result(this.schema(this.meta()!).overview())),
      }),
      defineTool({
        name: "schema_read",
        description:
          "Full detail for fields or subtrees: description, what their conditions read, value, status, reasons, fetched data, inline options.",
        parameters: pathsParam,
        replay: "safe",
        execute: (input: { paths: string[] }) =>
          Promise.resolve(result(this.schema(this.meta()!).read(input.paths))),
      }),
      defineTool({
        name: "schema_answer",
        description:
          "Answer fields. Per path: ok, suggested (a person answered it, so your value is kept beside theirs) or refused with the reason; then what became stale, visible or hidden.",
        parameters: {
          type: "object",
          properties: {
            answers: {
              type: "array",
              items: {
                type: "object",
                properties: { path: { type: "string" }, value: {} },
                required: ["path", "value"],
              },
            },
          },
          required: ["answers"],
          additionalProperties: false,
        },
        execute: async (input: {
          answers: Array<{ path: string; value: unknown }>;
        }) => {
          const state = this.schema(this.meta()!);
          const results: WriteResult[] = [];
          for (const { path, value } of input.answers)
            results.push(await state.write(path, value, { agent: true }));
          this.record("schema.answer", { results });
          return result(results);
        },
      }),
      defineTool({
        name: "options_search",
        description:
          "One page of a field's options matching a query (default 20).",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            query: { type: "string" },
            cursor: { type: "string" },
          },
          required: ["path", "query"],
          additionalProperties: false,
        },
        replay: "safe",
        execute: async (input: {
          path: string;
          query: string;
          cursor?: string;
        }) =>
          result(
            await this.schema(this.meta()!).options({
              path: input.path,
              query: input.query,
              limit: 20,
              ...(input.cursor && { cursor: input.cursor }),
            }),
          ),
      }),
      defineTool({
        name: "options_page",
        description: "The next page of a field's options in source order.",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, cursor: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        },
        replay: "safe",
        execute: async (input: { path: string; cursor?: string }) =>
          result(
            await this.schema(this.meta()!).options({
              path: input.path,
              limit: 20,
              ...(input.cursor && { cursor: input.cursor }),
            }),
          ),
      }),
      defineTool({
        name: "decide",
        description:
          "Pick from a field's full option list with the decision model, on the platform side: one pick, or the best `keep` with probabilities. The list never enters your context. Answer the field yourself afterwards.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            prompt: { type: "string" },
            keep: { type: "integer", minimum: 1, maximum: 255 },
          },
          required: ["path", "prompt"],
          additionalProperties: false,
        },
        execute: async (input: {
          path: string;
          prompt: string;
          keep?: number;
        }) => {
          const current = this.meta()!;
          const state = this.schema(current);
          const options = await state.allOptions(input.path);
          if (options.length === 0)
            return result(`${input.path} has no options`, true);
          const labels = new Map(options.map((o) => [o.id, o.label]));
          if (await this.overLimit())
            return result(
              "decide refused: the organization reached its monthly spending limit",
              true,
            );
          try {
            const decided = await decide(modelEndpoint(this.env, "decide"), {
              prompt: input.prompt,
              case: { input: current.input.text, answers: state.output() },
              options: options.map(({ id, label, description }) => ({
                id,
                label,
                ...(description && { description }),
              })),
              keep: input.keep ?? 1,
            });
            this.record("decide", {
              path: input.path,
              options: options.length,
              picks: decided.picks,
              usage: decided.usage,
            });
            return result({
              picks: decided.picks.map((p) => ({
                ...p,
                label: labels.get(p.id),
              })),
            });
          } catch (error) {
            if (error instanceof ModelError)
              return result(
                `decide failed: ${error.code}: ${error.message}`,
                true,
              );
            throw error;
          }
        },
      }),
    ];
  }

  harness = new PiHarness({
    harness: ({ storage, context, onWake }) => {
      const meta = this.meta();
      if (!meta) throw new Error("case has not started");
      const worker = agentWorker(this.env, meta, this.ctx.exports);
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
            const problems = (result.effects ?? [])
              .map((effect) => this.applyEffect(this.meta()!, effect))
              .filter((p): p is string => p !== null);
            const output =
              typeof result.output === "string"
                ? result.output
                : JSON.stringify(result.output);
            return {
              output: [
                {
                  type: "text",
                  text: problems.length
                    ? `${output}\n${problems.join("\n")}`
                    : output,
                },
              ],
              isError: result.isError || problems.length > 0,
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
            section("schema", () => {
              const current = this.meta();
              const overview = current ? this.schema(current).overview() : "";
              return overview
                ? `The case's output schema as it stands. Read any part with schema_read, answer with schema_answer, and use decide for long option lists. Fields a person answered are theirs; your answer to one is kept as a suggestion beside it.\n\n${overview}`
                : undefined;
            }),
          ],
          tools: [...tools, ...this.platformTools(meta)],
        }),
      );
      let turn = 0;
      const models = openModels(
        this.env,
        (fn) => (model, modelContext, options) => {
          const out = createAssistantMessageEventStream();
          const stop = (reason: "aborted" | "error", message: string) =>
            out.push({
              type: "error",
              reason,
              error: {
                role: "assistant",
                content: [],
                api: model.api,
                provider: model.provider,
                model: model.id,
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    total: 0,
                  },
                },
                stopReason: reason,
                errorMessage: message,
                timestamp: Date.now(),
              },
            });
          void (async () => {
            if (await this.overLimit())
              return stop("aborted", "spending_limit_reached");
            const current = ++turn;
            const started = Date.now();
            this.record("model.request", {
              turn: current,
              model: model.id,
              reasoning:
                (options as { reasoning?: string } | undefined)?.reasoning ??
                options?.reasoningEffort,
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
            for await (const event of events) out.push(event);
            out.end(await events.result());
          })().catch((error: unknown) => stop("error", String(error)));
          return out;
        },
      );
      registry.install(
        largeSummaries(
          models,
          meta.manifest.model,
          meta.manifest.reasoning,
          (data) => this.record("context.summary", data),
        ),
      );
      return Harness.open(
        storage,
        { models, registry, onWake, settings: { compaction: COMPACTION } },
        context,
      );
    },
    defaults: { maxTurns: MAX_TURNS },
  });

  lifecycle = Lifecycle.install(this).use(this.harness);

  // The case's input for the agent's first run. OCR every file before the
  // first model call when the agent switched it on; otherwise the agent only
  // learns the files' names. Null when the spending limit halted the case.
  private async firstPrompt(meta: Meta) {
    const files = meta.input.files ?? [];
    if (files.length === 0) return meta.input.text;
    const parts: string[] = [];
    for (const file of files) {
      if (!meta.manifest.ocr || !this.env.PLATFORM) {
        parts.push(`- ${file.name} (${file.contentType})`);
        continue;
      }
      if (await this.overLimit()) return null;
      try {
        const { markdown } = await this.env.PLATFORM.ocrFile({
          organizationId: meta.organizationId,
          fileId: file.id,
        });
        this.record("ocr", { fileId: file.id, chars: markdown.length });
        parts.push(`<file name="${file.name}">\n${markdown}\n</file>`);
      } catch (error) {
        this.record("ocr", { fileId: file.id, error: String(error) });
        parts.push(`- ${file.name} (${file.contentType}; OCR failed)`);
      }
    }
    return `${meta.input.text}\n\nFiles:\n${parts.join("\n")}`;
  }

  async start(start: StartCase): Promise<CaseView> {
    this.expectName(start);
    if (this.meta()) return this.view();
    const response = await agentWorker(this.env, start).fetch("/manifest");
    if (!response.ok)
      throw new Error(
        `agent Worker ${start.script} answered ${response.status}`,
      );
    const manifest = withSettings(
      await response.json<Manifest>(),
      start.settings,
    );
    if (manifest.protocol !== PROTOCOL)
      throw new Error(
        `agent protocol ${String(manifest.protocol)} is not supported`,
      );
    const meta: Meta = {
      ...start,
      status: "running",
      manifest,
      run: 1,
      operation: `case:${start.caseId}`,
      waitingOn: null,
      unprompted: true,
    };
    this.save(meta);
    this.record("case.started", {
      deploymentId: start.deploymentId,
      script: start.script,
      sdk: manifest.sdk,
      model: manifest.model,
      reasoning: manifest.reasoning,
      tools: manifest.tools.map((t) => t.name),
      input: start.input,
    });
    this.post(meta, "input", "input", start.input.text);
    await this.report(meta, {
      type: "status",
      status: "running",
      waitingOn: null,
      reason: null,
      answers: null,
      error: null,
    });
    await this.schema(meta).evaluate("all");
    await this.harness.root({
      agent: {
        model: { provider: PROVIDER, modelId: manifest.model },
        thinkingLevel: manifest.reasoning,
      },
    });
    const prompt = await this.firstPrompt(meta);
    if (prompt === null) return this.view();
    this.prompted();
    await this.harness.submit(prompt, { operationId: meta.operation });
    this.ctx.waitUntil(this.watch());
    return this.view();
  }

  // Waits for Pi to settle the current run, then records the outcome and
  // seals the capture. Re-armed by the constructor after an eviction, so it
  // runs in whichever instance sees the end.
  private async watch() {
    const meta = this.meta();
    if (!meta) return;
    const result = await this.harness.wait(meta.operation);
    await this.finish(meta.operation, result);
  }

  private async finish(operation: string, result: PiOperationResult) {
    const meta = this.meta();
    if (!meta || meta.status !== "running" || meta.operation !== operation)
      return;
    const done = result.status === "done";
    if (done && result.text) this.post(meta, "agent", "agent", result.text);
    const schema = this.schema(meta);
    if (done)
      await schema
        .evaluate("all")
        .catch((error: unknown) =>
          this.record("schema.error", { error: String(error) }),
        );
    const status: CaseStatus = !done
      ? "failed"
      : meta.waitingOn
        ? "waiting"
        : "completed";
    const next: Meta = {
      ...meta,
      status,
      ...(done
        ? { ...(result.text !== undefined && { answer: result.text }) }
        : { reason: result.reason ?? "unanswered" }),
    };
    this.save(next);
    this.record(
      done ? "case.completed" : "case.failed",
      done ? { answer: next.answer ?? "", status } : { reason: next.reason },
    );
    await this.seal(next);
    await this.report(next, {
      type: "status",
      status,
      waitingOn: status === "waiting" ? (next.waitingOn?.group ?? null) : null,
      reason: status === "waiting" ? (next.waitingOn?.reason ?? null) : null,
      answers:
        status === "completed" && schema.enabled ? schema.output() : null,
      error:
        status === "failed"
          ? { code: "run_failed", message: next.reason ?? "unanswered" }
          : null,
    });
  }

  private async seal(meta: Meta) {
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
      status: meta.status === "failed" ? "failed" : "completed",
      usage: this.usage(events),
      events,
    };
    await this.env.RUNS.put(captureKey(meta), JSON.stringify(capture), {
      httpMetadata: { contentType: "application/json" },
    });
  }

  // Rerun: re-evaluate everything and resume the agent with what changed
  // since its last run (design doc 05). A person's answers stay theirs; the
  // agent's differing values land beside them as suggestions.
  async rerun(notes: ReviewNote[] = []): Promise<CaseState> {
    const meta = this.meta();
    if (!meta) throw new Error("case has not started");
    if (meta.status === "running") throw new Error("case is running");
    const run = meta.run + 1;
    const next: Meta = {
      ...meta,
      status: "running",
      run,
      operation: `case:${meta.caseId}:run:${run}`,
      waitingOn: null,
    };
    delete next.reason;
    this.save(next);
    const schema = this.schema(next);
    await schema.evaluate("all");
    const messages = this.thread().filter(
      (m) => m.kind === "person" && this.messageRun(m.id) >= meta.run,
    );
    const stale = schema.fields().filter((f) => f.answer?.status === "stale");
    const lines = [
      "Continue this case: a person asked you to run again.",
      ...(notes.length
        ? [
            "",
            "Changes people made since your last run:",
            ...notes.map(
              (n) =>
                `- ${n.kind}${n.path ? ` ${n.path}` : ""}${n.kind === "field.confirmed" ? "" : `: ${JSON.stringify(n.before)} → ${JSON.stringify(n.after)}`}`,
            ),
          ]
        : []),
      ...(stale.length
        ? [
            "",
            "Stale answers to revisit:",
            ...stale.map(
              (f) =>
                `- ${f.path} because ${(f.answer!.staleBecause ?? []).map((r) => `${r.path} changed`).join(", ")}`,
            ),
          ]
        : []),
      ...(messages.length
        ? ["", "Messages in the thread:", ...messages.map((m) => `- ${m.text}`)]
        : []),
    ];
    this.post(next, "platform", "event", `Run ${run} started`);
    await this.report(next, {
      type: "status",
      status: "running",
      waitingOn: null,
      reason: null,
      answers: null,
      error: null,
    });
    const prompt = meta.unprompted
      ? await this.firstPrompt(next)
      : lines.join("\n");
    if (prompt === null) return this.state();
    this.prompted();
    await this.harness.submit(prompt, { operationId: next.operation });
    this.ctx.waitUntil(this.watch());
    return this.state();
  }

  private prompted() {
    const meta = this.meta()!;
    delete meta.unprompted;
    this.save(meta);
  }

  private messageRun(id: string) {
    return (
      this.ctx.storage.sql
        .exec<{ run: number }>("SELECT run FROM thread WHERE id = ?", id)
        .toArray()[0]?.run ?? 0
    );
  }

  async edit(input: {
    path: string;
    value: unknown;
    version: number;
    userId: string;
  }) {
    const meta = this.meta();
    if (!meta) throw new Error("case has not started");
    const result = await this.schema(meta).write(
      input.path,
      input.value,
      { person: input.userId },
      input.version,
    );
    return {
      result,
      answer: this.schema(meta).answer(input.path),
      checks: this.schema(meta).checks(),
    };
  }

  confirm(input: { path: string; version: number; userId: string }) {
    const meta = this.meta();
    if (!meta) throw new Error("case has not started");
    const schema = this.schema(meta);
    const result = schema.confirm(input.path, input.version);
    return {
      result,
      answer: schema.answer(input.path),
      checks: schema.checks(),
    };
  }

  async acceptSuggestion(input: {
    path: string;
    version: number;
    userId: string;
  }) {
    const meta = this.meta();
    if (!meta) throw new Error("case has not started");
    const current = this.schema(meta).answer(input.path);
    if (!current || current.suggestedValue === undefined)
      return {
        result: {
          result: "refused" as const,
          path: input.path,
          reason: "no suggestion",
        },
        answer: current,
        checks: this.schema(meta).checks(),
      };
    return this.edit({ ...input, value: current.suggestedValue });
  }

  async options(input: {
    path: string;
    query?: string;
    cursor?: string;
    limit?: number;
  }) {
    const meta = this.meta();
    if (!meta) throw new Error("case has not started");
    return this.schema(meta).options({
      path: input.path,
      limit: input.limit ?? 20,
      ...(input.query !== undefined && { query: input.query }),
      ...(input.cursor !== undefined && { cursor: input.cursor }),
    });
  }

  // A person's message in the thread. People reference groups with @slug,
  // never people; a reference notifies the group like an agent's tag.
  async message(input: { userId: string; text: string }) {
    const meta = this.meta();
    if (!meta) throw new Error("case has not started");
    const id = this.post(meta, `person:${input.userId}`, "person", input.text);
    const slugs = new Set(this.groups(meta).map((g) => g.slug));
    const mentioned = [
      ...input.text.matchAll(/(?:^|\s)@([a-z0-9][a-z0-9-]{0,47})\b/g),
    ]
      .map((m) => m[1]!)
      .filter((slug) => slugs.has(slug));
    for (const group of new Set(mentioned))
      await this.report(meta, {
        type: "mention",
        group,
        messageId: id,
        by: `person:${input.userId}`,
        message: input.text,
      });
    return { id, mentioned: [...new Set(mentioned)] };
  }

  async cancel() {
    const meta = this.meta();
    if (!meta) throw new Error("case has not started");
    if (meta.status === "completed" || meta.status === "cancelled")
      return this.state();
    if (meta.status === "running")
      await this.harness.abort().catch(() => false);
    const next: Meta = { ...meta, status: "cancelled", waitingOn: null };
    this.save(next);
    this.post(next, "platform", "event", "Cancelled");
    await this.report(next, {
      type: "status",
      status: "cancelled",
      waitingOn: null,
      reason: null,
      answers: null,
      error: null,
    });
    return this.state();
  }

  state(): CaseState {
    const meta = this.meta();
    if (!meta) throw new Error("case has not started");
    const schema = this.schema(meta);
    return {
      caseId: meta.caseId,
      status: meta.status,
      run: meta.run,
      waitingOn: meta.waitingOn,
      reason: meta.reason ?? null,
      fields: schema.fields(),
      checks: schema.checks(),
      answers: schema.output(),
      thread: this.thread(),
    };
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
