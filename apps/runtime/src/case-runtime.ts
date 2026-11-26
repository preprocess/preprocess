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
import { decideCostMicroUsd, microUsd } from "@preprocess/models/prices";
import { runMode } from "@preprocess/runmode";
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
import {
  type Approval,
  type ApprovalEffect,
  APPROVAL_TABLES,
  Approvals,
} from "./approvals.ts";
import { agentWorker } from "./dispatch.ts";
import type {
  CaseEvent,
  CaseFile,
  CaseStatus,
  Env,
  EvalEvent,
  GroupRef,
  Settings,
  MemoryRule,
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
  approvals: Approval[];
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
  // An eval case's side-effect tool results, from the source case's capture.
  replay?: Replay[];
  // When the current run passes timeoutSeconds, as epoch milliseconds.
  deadline?: number;
  // What people decided on tool calls, for the agent's next run.
  decisions?: string[];
};

type Replay = { name: string; input: string; result: ToolResult };

// Object keys sorted, so equal inputs compare equal however they were built.
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );

// The side-effect results a replayed case may reuse: each tool call's input
// with the result it got, in the order they ran.
const replayFrom = (
  capture: RunCapture,
  sideEffects: Set<string>,
): Replay[] => {
  const calls = new Map<string, { name: string; input: unknown }>();
  const replay: Replay[] = [];
  for (const event of capture.events) {
    const data = event.data as {
      callId?: string;
      name?: string;
      input?: unknown;
      output?: ToolResult["output"];
      isError?: boolean;
      effects?: ToolResult["effects"];
    };
    if (!data.callId || !data.name || !sideEffects.has(data.name)) continue;
    if (event.kind === "tool.call")
      calls.set(data.callId, { name: data.name, input: data.input });
    if (event.kind !== "tool.result") continue;
    const call = calls.get(data.callId);
    if (!call) continue;
    replay.push({
      name: call.name,
      input: canonical(call.input),
      result: {
        output: data.output ?? "",
        isError: data.isError ?? false,
        ...(data.effects && { effects: data.effects }),
      },
    });
  }
  return replay;
};

const MAX_TURNS = 24;

const subject = (a: Approval) =>
  a.level === "completion"
    ? "completing the case"
    : a.level === "tool"
      ? `the call to ${a.target}`
      : a.target;

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
    // TODO: nothing reads sandboxImage until tools run in a sandbox.
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
       CREATE TABLE IF NOT EXISTS thread (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, at TEXT NOT NULL, by TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, grp TEXT, run INTEGER NOT NULL);${SCHEMA_TABLES}${APPROVAL_TABLES}`,
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
      () => agentWorker(this.env, meta, this.ctx),
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

  // Tokens are the agent model's; cost is everything the case was charged:
  // each model response as pi-ai priced it, and each decide and OCR call.
  private usage(events: CaptureEvent[]): Usage {
    return events.reduce<Usage>(
      (total, e) => {
        if (e.kind === "decide" || e.kind === "ocr") {
          const cost = (e.data.costMicroUsd as number | undefined) ?? 0;
          return {
            ...total,
            costMicroUsd: total.costMicroUsd + cost,
            charges: {
              ...total.charges,
              [e.kind]: total.charges[e.kind] + cost,
            },
          };
        }
        if (e.kind !== "model.response") return total;
        const usage = (e.data.usage ?? {}) as {
          input?: number;
          output?: number;
          cost?: { total?: number };
        };
        const cost = microUsd(usage.cost?.total ?? 0);
        return {
          input: total.input + (usage.input ?? 0),
          output: total.output + (usage.output ?? 0),
          costMicroUsd: total.costMicroUsd + cost,
          charges: { ...total.charges, model: total.charges.model + cost },
        };
      },
      {
        input: 0,
        output: 0,
        costMicroUsd: 0,
        charges: { model: 0, decide: 0, ocr: 0 },
      },
    );
  }

  // What a status event reports of the case's charges so far.
  private charged() {
    const { costMicroUsd, charges } = this.usage(this.events());
    return { costMicroUsd, charges };
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
      ...(event.type === "status" && {
        ...this.charged(),
        ...(this.captureBytes !== undefined && {
          captureBytes: this.captureBytes,
        }),
      }),
      organizationId: meta.organizationId,
      agentId: meta.agentId,
      caseId: meta.caseId,
    };
    this.record("case.event", full);
    if (!this.env.PLATFORM) return;
    try {
      if (meta.eval) {
        if (full.type === "status")
          await this.env.PLATFORM.evalEvent(this.evalEvent(meta, full));
        return;
      }
      await this.env.PLATFORM.caseEvent(full);
    } catch (error) {
      this.record("platform.error", {
        event: event.type,
        error: String(error),
      });
    }
  }

  private evalEvent(
    meta: Meta,
    event: Extract<CaseEvent, { type: "status" }>,
  ): EvalEvent {
    return {
      organizationId: meta.organizationId,
      agentId: meta.agentId,
      caseId: meta.caseId,
      runId: meta.eval!.runId,
      sourceCaseId: meta.eval!.sourceCaseId,
      status: event.status,
      waitingOn: event.waitingOn,
      reason: event.error?.message ?? event.haltReason ?? event.reason,
      answers: event.answers,
      ...this.charged(),
      captureKey: captureKey(meta),
    };
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

  // One tool call through the agent's Worker. A call that failed runs again
  // up to toolRetries times, but never one with side effects: it may have
  // half happened. A call that needs approval does not run: it waits for a
  // person, and runs again with approved once they approve.
  private async callTool(
    meta: Meta,
    tool: Manifest["tools"][number],
    input: unknown,
    callId: string,
    approved = false,
  ): Promise<{ text: string; isError: boolean }> {
    const worker = agentWorker(this.env, meta, this.ctx);
    this.record("tool.call", {
      callId,
      name: tool.name,
      input,
      ...(approved && { approved }),
    });
    // An eval case asks for an unconditional approval before it looks for
    // the source case's result; a conditional one comes back in the replayed
    // result, as the source case's call got it.
    const rule = meta.manifest.approvals?.tools.find(
      (t) => t.name === tool.name,
    );
    if (meta.eval && tool.sideEffects && !approved && rule && !rule.conditional)
      return {
        text: this.requestToolApproval(tool.name, input, {
          type: "approval",
          group: rule.group,
          reason: null,
        }),
        isError: false,
      };
    const retries = tool.sideEffects ? 0 : (meta.manifest.toolRetries ?? 0);
    let result: ToolResult;
    // An eval case never repeats a side effect (design doc 09): it gets the
    // source case's result for the same input, or an error.
    if (meta.eval && tool.sideEffects) {
      result = this.replay(tool.name, input);
      this.record("tool.result", {
        callId,
        name: tool.name,
        ms: 0,
        replayed: true,
        ...result,
      });
    } else
      for (let attempt = 0; ; attempt++) {
        const started = Date.now();
        result = await worker
          .fetch(`/tools/${tool.name}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              input,
              case: { id: meta.caseId },
              callId,
              ...(approved && { approved }),
            }),
          })
          .then(async (response) =>
            response.ok
              ? await response.json<ToolResult>()
              : {
                  output: `agent Worker answered ${response.status}`,
                  isError: true,
                  threw: true as const,
                },
          )
          .catch((error: unknown) => ({
            output: `agent Worker failed: ${String(error)}`,
            isError: true,
            threw: true as const,
          }));
        this.record("tool.result", {
          callId,
          name: tool.name,
          ms: Date.now() - started,
          ...(attempt > 0 && { attempt }),
          ...result,
        });
        if (!result.threw || attempt >= retries) break;
      }
    const effects = result.effects ?? [];
    const approval = effects.find(
      (e): e is ApprovalEffect => e.type === "approval",
    );
    if (approval && !approved)
      return {
        text: this.requestToolApproval(tool.name, input, approval),
        isError: false,
      };
    const problems = effects
      .filter(
        (e): e is Exclude<Effect, ApprovalEffect> => e.type !== "approval",
      )
      .map((effect) => this.applyEffect(this.meta()!, effect))
      .filter((p): p is string => p !== null);
    const output =
      typeof result.output === "string"
        ? result.output
        : JSON.stringify(result.output);
    return {
      text: problems.length ? `${output}\n${problems.join("\n")}` : output,
      isError: result.isError || problems.length > 0,
    };
  }

  private requestToolApproval(
    name: string,
    input: unknown,
    effect: ApprovalEffect,
  ) {
    const meta = this.meta()!;
    if (
      effect.group !== null &&
      !this.groups(meta).some((g) => g.slug === effect.group)
    )
      return `${name} did not run: it needs approval from group ${effect.group}, which has no access to this agent.`;
    const approval = this.approvals().request({
      level: "tool",
      target: name,
      group: effect.group,
      payload: input,
      reason: effect.reason,
      run: meta.run,
    });
    this.record("approval.requested", { ...approval });
    this.post(
      meta,
      "platform",
      "event",
      `Waiting for ${effect.group ?? "an operator"} to approve ${name}`,
      effect.group,
    );
    this.ctx.waitUntil(this.report(meta, { type: "approval", approval }));
    return `${name} has not run: it needs approval from ${effect.group ? `group ${effect.group}` : "an operator"} first. Do not call it again. Finish what you can without it and end your turn; you will be told the decision.`;
  }

  private approvals() {
    return new Approvals(this.ctx.storage.sql);
  }

  private applyEffect(
    meta: Meta,
    effect: Exclude<Effect, ApprovalEffect>,
  ): string | null {
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

  // Takes the first unused recorded result for this tool and input, so a
  // tool called twice with the same input gets both results in order.
  private replay(name: string, input: unknown): ToolResult {
    const meta = this.meta()!;
    const replay = meta.replay ?? [];
    const key = canonical(input);
    const index = replay.findIndex((r) => r.name === name && r.input === key);
    if (index === -1)
      return {
        output: `${name} has side effects and is not available in evals: the original case made no call with this input`,
        isError: true,
      };
    this.save({ ...meta, replay: replay.filter((_, i) => i !== index) });
    return replay[index]!.result;
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
        name: "memory_propose",
        description:
          "Propose a rule for this agent to remember across cases, such as how a customer's documents are laid out. A person approves or dismisses it; once approved, every later case receives it. Propose only what will hold for future cases, in one sentence.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", maxLength: 500 },
            reason: {
              type: "string",
              description: "What in this case taught you the rule",
            },
          },
          required: ["text"],
          additionalProperties: false,
        },
        execute: async (input: { text: string; reason?: string }) => {
          const current = this.meta()!;
          if (current.eval)
            return result("not recorded: eval runs do not propose rules");
          if (!this.env.PLATFORM) return result("proposed");
          const proposed = await this.env.PLATFORM.proposeMemory({
            organizationId: current.organizationId,
            agentId: current.agentId,
            caseId: current.caseId,
            text: input.text,
            reason: input.reason ?? null,
          });
          return proposed.result === "refused"
            ? result(`not proposed: ${proposed.reason}`, true)
            : result(
                proposed.result === "duplicate"
                  ? "already proposed on this case"
                  : "proposed; a person will approve or dismiss it",
              );
        },
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
              costMicroUsd:
                runMode(this.env).kind === "cloud"
                  ? decideCostMicroUsd(decided.usage.inputTokens)
                  : 0,
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
      const tools = meta.manifest.tools.map((tool) =>
        defineTool({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          replay: tool.sideEffects ? "unsafe" : "safe",
          execute: async (input, api) => {
            const done = await this.callTool(
              this.meta()!,
              tool,
              input,
              String(api.taskId),
            );
            return {
              output: [{ type: "text", text: done.text }],
              isError: done.isError,
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
            section("memory", () => {
              const rules = this.meta()?.memories ?? [];
              return rules.length
                ? [
                    "Rules people approved for this agent. Follow them:",
                    ...rules.map((r) => `- ${r.text}`),
                  ].join("\n")
                : undefined;
            }),
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
      if (meta.manifest.ocr && this.env.PLATFORM && (await this.overLimit()))
        return null;
      parts.push(await this.filePart(meta, file));
    }
    return `${meta.input.text}\n\nFiles:\n${parts.join("\n")}`;
  }

  // One file for a prompt: its text by OCR when the agent switched OCR on,
  // else its name.
  private async filePart(meta: Meta, file: CaseFile) {
    if (!meta.manifest.ocr || !this.env.PLATFORM)
      return `- ${file.name} (${file.contentType})`;
    try {
      const { markdown, pages, costMicroUsd } = await this.env.PLATFORM.ocrFile(
        {
          organizationId: meta.organizationId,
          fileId: file.id,
        },
      );
      this.record("ocr", {
        fileId: file.id,
        chars: markdown.length,
        pages,
        costMicroUsd,
      });
      return `<file name="${file.name}">\n${markdown}\n</file>`;
    } catch (error) {
      this.record("ocr", { fileId: file.id, error: String(error) });
      return `- ${file.name} (${file.contentType}; OCR failed)`;
    }
  }

  private async sourceReplay(key: string, manifest: Manifest) {
    const object = await this.env.RUNS.get(key);
    if (!object) return [];
    return replayFrom(
      await object.json<RunCapture>(),
      new Set(manifest.tools.filter((t) => t.sideEffects).map((t) => t.name)),
    );
  }

  async start(start: StartCase): Promise<CaseView> {
    this.expectName(start);
    if (this.meta()) return this.view();
    const response = await agentWorker(this.env, start, this.ctx).fetch(
      "/manifest",
    );
    if (!response.ok)
      throw new Error(
        `agent code of ${start.deploymentId} answered ${response.status}`,
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
      ...(start.eval && {
        replay: await this.sourceReplay(start.eval.captureKey, manifest),
      }),
    };
    this.save(meta);
    this.record("case.started", {
      deploymentId: start.deploymentId,
      bundleHash: start.bundleHash,
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
    await this.armTimeout();
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
    if (done) {
      await this.schema(meta)
        .evaluate("all")
        .catch((error: unknown) =>
          this.record("schema.error", { error: String(error) }),
        );
      await this.close({
        ...meta,
        ...(result.text !== undefined && { answer: result.text }),
      });
      return;
    }
    const next: Meta = {
      ...meta,
      status: "failed",
      reason: result.reason ?? "unanswered",
    };
    this.save(next);
    this.record("case.failed", { reason: next.reason });
    await this.seal(next);
    await this.report(next, {
      type: "status",
      status: "failed",
      waitingOn: null,
      reason: null,
      answers: null,
      error: { code: "run_failed", message: next.reason ?? "unanswered" },
    });
  }

  // Where a case stands once its run is done: waiting on a group, on its
  // checks and success condition, or on approvals; or completed.
  private async close(meta: Meta) {
    const schema = this.schema(meta);
    const done = schema.enabled ? schema.done() : { ok: true as const };
    const blocking = done.ok ? this.settleApprovals(meta) : [];
    const status: CaseStatus =
      meta.waitingOn || !done.ok || blocking.length ? "waiting" : "completed";
    const next: Meta = { ...meta, status };
    if (status === "completed") delete next.reason;
    this.save(next);
    this.record("case.completed", { answer: next.answer ?? "", status });
    await this.seal(next);
    const first = blocking[0];
    await this.report(next, {
      type: "status",
      status,
      waitingOn:
        status === "waiting"
          ? (next.waitingOn?.group ?? first?.group ?? null)
          : null,
      reason:
        status === "waiting"
          ? (next.waitingOn?.reason ??
            (done.ok ? null : done.reason) ??
            next.reason ??
            (first ? `Approval needed: ${subject(first)}` : null))
          : null,
      answers:
        status === "completed" && schema.enabled ? schema.output() : null,
      error: null,
      ...(status === "waiting" &&
        !next.waitingOn &&
        first && { approvalId: first.id }),
      ...(status === "completed" && {
        completed: { input: next.input, captureKey: captureKey(next) },
      }),
    });
    await this.reportReview(next);
  }

  private reportReview(meta: Meta) {
    const schema = this.schema(meta);
    return this.report(meta, {
      type: "review",
      fields: schema.enabled ? schema.unreviewed() : [],
    });
  }

  // Output and completion approvals for the answers as they stand. Returns
  // what keeps the case from completing: held tool calls, open requests, and
  // output approvals rejected in this run.
  private settleApprovals(meta: Meta): Approval[] {
    const approvals = this.approvals();
    // The agent has more to do once a held call is decided: output is not
    // final yet.
    const held = approvals.pending().filter((a) => a.level === "tool");
    if (held.length) return held;
    const schema = this.schema(meta);
    const rules = schema.enabled
      ? schema.approvalRules()
      : meta.manifest.approvals?.agent?.conditional === false
        ? [{ target: "", group: meta.manifest.approvals.agent.group }]
        : [];
    const keep = new Set<string>();
    const blocking: Approval[] = [];
    for (const rule of rules) {
      const level = rule.target === "" ? "completion" : "field";
      keep.add(`${level}:${rule.target}`);
      const { approval, created, stale } = approvals.ensure({
        level,
        target: rule.target,
        group: rule.group,
        payload:
          level === "completion"
            ? { run: meta.run }
            : schema.valueAt(rule.target),
        run: meta.run,
      });
      for (const a of stale)
        this.ctx.waitUntil(
          this.report(meta, { type: "approval", approval: a }),
        );
      if (created) {
        this.record("approval.requested", { ...approval });
        this.post(
          meta,
          "platform",
          "event",
          `Waiting for ${rule.group ?? "an operator"} to approve ${subject(approval)}`,
          rule.group,
        );
        this.ctx.waitUntil(this.report(meta, { type: "approval", approval }));
      }
      if (approval.status === "rejected") blocking.push(approval);
    }
    for (const a of approvals.retire(keep))
      this.ctx.waitUntil(this.report(meta, { type: "approval", approval: a }));
    return [...approvals.pending(), ...blocking];
  }

  // A person approves or rejects an open request (spec `9). An approved tool
  // call runs with the input as approved; once no call of the run waits, the
  // agent continues with the decisions. Output and completion decisions
  // settle the case; a rejection leaves it waiting on people.
  async decide(input: {
    id: string;
    approve: boolean;
    userId: string;
    note: string | null;
  }): Promise<CaseState> {
    const meta = this.meta();
    if (!meta) throw new Error("case has not started");
    if (meta.status === "running") throw new Error("case is running");
    const approvals = this.approvals();
    const found = approvals.get(input.id);
    if (!found || found.status !== "pending")
      throw new Error("approval is not pending");
    const by = `person:${input.userId}`;
    const decided = approvals.decide(
      found.id,
      input.approve ? "approved" : "rejected",
      by,
      input.note,
    );
    this.record("approval.decided", { ...decided });
    this.post(
      meta,
      by,
      "event",
      `${input.approve ? "Approved" : "Rejected"} ${subject(decided)}${input.note ? `: ${input.note}` : ""}`,
      decided.group,
    );
    await this.report(meta, { type: "approval", approval: decided });
    if (decided.level === "tool") {
      const tool = meta.manifest.tools.find((t) => t.name === decided.target);
      const lines: string[] = [];
      if (input.approve && tool) {
        const done = await this.callTool(
          meta,
          tool,
          decided.payload,
          decided.id,
          true,
        );
        lines.push(
          `A person approved your call to ${decided.target}. It ran and returned:`,
          done.text,
        );
      } else
        lines.push(
          `A person rejected your call to ${decided.target}, so it did not run.${input.note ? ` Their reason: ${input.note}` : ""}`,
        );
      const next: Meta = {
        ...this.meta()!,
        decisions: [...(meta.decisions ?? []), ...lines],
      };
      this.save(next);
      if (approvals.pending().some((a) => a.level === "tool"))
        return this.state();
      return this.continueWith(() => [
        "Continue this case: people decided on calls that needed approval.",
        "",
        ...(next.decisions ?? []),
      ]);
    }
    await this.close(
      input.approve
        ? meta
        : {
            ...meta,
            reason: `Rejected ${subject(decided)}${input.note ? `: ${input.note}` : ""}`,
          },
    );
    return this.state();
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
    const body = new TextEncoder().encode(JSON.stringify(capture));
    await this.env.RUNS.put(captureKey(meta), body, {
      httpMetadata: { contentType: "application/json" },
    });
    this.captureBytes = body.byteLength;
  }

  // The size of the capture this object last stored, which storage counts.
  private captureBytes: number | undefined;

  // Rerun: re-evaluate everything and resume the agent with what changed
  // since its last run (design doc 05). A person's answers stay theirs; the
  // agent's differing values land beside them as suggestions.
  async rerun(
    notes: ReviewNote[] = [],
    memories?: MemoryRule[],
  ): Promise<CaseState> {
    const meta = this.meta();
    if (!meta) throw new Error("case has not started");
    if (meta.status === "running") throw new Error("case is running");
    // Files people attached since the last run join the case's input and
    // reach the agent in this run's prompt.
    const added = notes
      .filter((n) => n.kind === "file.added")
      .map((n) => n.after as CaseFile);
    const addedParts: string[] = [];
    for (const file of added) addedParts.push(await this.filePart(meta, file));
    notes = notes.filter((n) => n.kind !== "file.added");
    // Rules accepted or deleted since the last run apply from this one.
    this.save({
      ...meta,
      ...(memories && { memories }),
      ...(added.length && {
        input: {
          ...meta.input,
          files: [...(meta.input.files ?? []), ...added],
        },
      }),
    });
    return this.continueWith((schema) => {
      const messages = this.thread().filter(
        (m) => m.kind === "person" && this.messageRun(m.id) >= meta.run,
      );
      const stale = schema.fields().filter((f) => f.answer?.status === "stale");
      return [
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
        ...(addedParts.length
          ? ["", "Files people added to the case:", ...addedParts]
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
          ? [
              "",
              "Messages in the thread:",
              ...messages.map((m) => `- ${m.text}`),
            ]
          : []),
      ];
    });
  }

  // Starts the case's next run with a prompt built from the schema as it
  // stands, or the input itself if the agent has not had it yet.
  private async continueWith(
    lines: (schema: SchemaState) => string[],
  ): Promise<CaseState> {
    const meta = this.meta()!;
    const run = meta.run + 1;
    const next: Meta = {
      ...meta,
      status: "running",
      run,
      operation: `case:${meta.caseId}:run:${run}`,
      waitingOn: null,
    };
    delete next.reason;
    delete next.deadline;
    delete next.decisions;
    this.save(next);
    const schema = this.schema(next);
    await schema.evaluate("all");
    const text = lines(schema).join("\n");
    this.post(next, "platform", "event", `Run ${run} started`);
    await this.report(next, {
      type: "status",
      status: "running",
      waitingOn: null,
      reason: null,
      answers: null,
      error: null,
    });
    const prompt = meta.unprompted ? await this.firstPrompt(next) : text;
    if (prompt === null) return this.state();
    this.prompted();
    await this.armTimeout();
    await this.harness.submit(prompt, { operationId: next.operation });
    this.ctx.waitUntil(this.watch());
    return this.state();
  }

  // timeoutSeconds is each run's wall clock, from the agent's first prompt.
  private async armTimeout() {
    const meta = this.meta()!;
    const seconds = meta.manifest.timeoutSeconds;
    if (!seconds) return;
    meta.deadline = Date.now() + seconds * 1000;
    this.save(meta);
    await this.ctx.storage.setAlarm(meta.deadline);
  }

  override async alarm() {
    const meta = this.meta();
    if (meta?.status !== "running" || meta.deadline === undefined) return;
    if (Date.now() < meta.deadline) {
      await this.ctx.storage.setAlarm(meta.deadline);
      return;
    }
    const seconds = meta.manifest.timeoutSeconds ?? 0;
    const next: Meta = { ...meta, status: "failed", reason: "timeout" };
    delete next.deadline;
    this.save(next);
    this.record("case.failed", { reason: "timeout" });
    this.post(next, "platform", "event", `Timed out after ${seconds}s`);
    await this.harness.abort().catch(() => false);
    await this.seal(next);
    await this.report(next, {
      type: "status",
      status: "failed",
      waitingOn: null,
      reason: null,
      answers: null,
      error: {
        code: "timeout",
        message: `The run passed its ${seconds} second limit`,
      },
    });
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
    this.ctx.waitUntil(this.reportReview(meta));
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
    this.ctx.waitUntil(this.reportReview(meta));
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

  // A person completes a waiting case (spec 6): the same rule as the agent,
  // so it completes only when its checks pass and its success condition is
  // met, and approvals the code declared still apply.
  async complete(): Promise<
    | { result: "ok"; state: CaseState }
    | { result: "refused"; code: string; message: string }
  > {
    const meta = this.meta();
    if (!meta) throw new Error("case has not started");
    if (meta.status !== "waiting")
      return {
        result: "refused",
        code: "case_not_completable",
        message: `The case is ${meta.status}.`,
      };
    const schema = this.schema(meta);
    if (schema.enabled) {
      await schema.evaluate("all");
      const done = schema.done();
      if (!done.ok)
        return {
          result: "refused",
          code: "case_not_done",
          message: done.reason,
        };
    }
    const next: Meta = { ...meta, waitingOn: null };
    delete next.reason;
    await this.close(next);
    return { result: "ok", state: this.state() };
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
    const approvals = this.approvals();
    for (const open of approvals.pending())
      await this.report(next, {
        type: "approval",
        approval: approvals.decide(open.id, "stale", null, null),
      });
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

  // Retention (spec 16a): the run capture this object keeps beside the copy
  // in RUNS, or everything it holds when the case is deleted.
  dropCapture() {
    this.ctx.storage.sql.exec("DELETE FROM capture");
  }

  async wipe() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
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
      approvals: this.approvals().list(),
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
