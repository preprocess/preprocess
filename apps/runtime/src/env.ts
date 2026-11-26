import type { LogRecord } from "@preprocess/logs";
import type { SandboxReporter } from "@preprocess/sandbox";

import type { Approval } from "./approvals.ts";
import type { Charges } from "./capture.ts";
import type { CaseRuntime } from "./case-runtime.ts";
import type { SandboxLarge, SandboxMedium, SandboxSmall } from "./sandbox.ts";

export type Env = {
  STAGE: string;
  // Set on our cloud, unset on a self-hosted install; read it through
  // @preprocess/runmode. Only our cloud prices model, decide and OCR calls.
  PREPROCESS_REGION?: string;
  // Where each model is served (@preprocess/models endpoints): Baseten for
  // Kimi, DeepSeek and decide, the Workers AI binding for Qwen, an install's
  // own MODEL_ENDPOINTS, and MODEL_SERVICE_URL (the stub) for the rest.
  BASETEN_API_KEY?: string;
  AI?: Ai;
  MODEL_ENDPOINTS?: string;
  MODEL_SERVICE_URL?: string;
  MODEL_SERVICE_KEY?: string;
  CASE_RUNTIME: DurableObjectNamespace<CaseRuntime>;
  // Case sandboxes (spec 3), one class per size (sandbox.ts).
  SANDBOX_SMALL: DurableObjectNamespace<SandboxSmall>;
  SANDBOX_MEDIUM: DurableObjectNamespace<SandboxMedium>;
  SANDBOX_LARGE: DurableObjectNamespace<SandboxLarge>;
  RUNS: R2Bucket;
  // Agent code (design doc 03): each deployment's bundle in BUNDLES, loaded
  // as a Dynamic Worker. TAIL (apps/tail) turns its console output and
  // exceptions into run logs.
  LOADER: WorkerLoader;
  BUNDLES: R2Bucket;
  TAIL?: Fetcher;
  // The API Worker's MCP token service (design doc 03). The runtime hands
  // each dispatch an McpBroker capability that calls it.
  MCP_SERVICE?: McpService;
  // The API Worker's internal entrypoint: the one writer of the case index,
  // and the OCR service for files (design doc 04). Unbound in the runtime's
  // own tests, where reports are only captured.
  PLATFORM?: Platform;
};

export type NetworkRules = { allow: string[]; block: string[] };

export type McpProps = {
  organizationId: string;
  agentId: string;
  deploymentId: string;
};

export type McpService = {
  listTools(props: McpProps, server: string): Promise<unknown>;
  call(
    props: McpProps,
    server: string,
    tool: string,
    args: unknown,
  ): Promise<unknown>;
};

// What the runtime needs to know about the deployment a case runs on. The
// platform's deployment record supplies it; agent code never does.
export type Deployment = {
  organizationId: string;
  agentId: string;
  deploymentId: string;
  // The SHA-256 the deploy recorded for the bundle; every load checks it.
  bundleHash: string;
  network: NetworkRules;
};

// A group with access to the agent: a grant on it, or Developers (doc 06).
// The agent sees these and never their members.
export type GroupRef = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  access: "operator" | "viewer" | "developers";
};

export type MemoryRule = { id: string; text: string };

export type MemoryProposal = Pick<Deployment, "organizationId" | "agentId"> & {
  caseId: string;
  text: string;
  reason: string | null;
};

export type ProposeResult =
  | { result: "proposed" | "duplicate"; id: string }
  | { result: "refused"; reason: string };

export type CaseFile = { id: string; name: string; contentType: string };

export type StartCase = Deployment & {
  caseId: string;
  input: { text: string; files?: CaseFile[] };
  groups?: GroupRef[];
  // The agent's accepted memory rules (spec 10), read into its instructions;
  // an eval run passes the snapshot it started with.
  memories?: MemoryRule[];
  // The agent's effective settings (apps/api/src/settings.ts): dashboard
  // overrides and organization defaults over the code's values. Null means
  // the runtime's own behavior.
  settings?: Settings;
  // Set for an eval case (design doc 09): a replay of a completed case whose
  // capture holds the results its side-effect tools return.
  eval?: { runId: string; sourceCaseId: string; captureKey: string };
};

// What an eval case reports once it settles, instead of case events: no
// inbox, webhooks or email.
export type EvalEvent = CaseKey & {
  runId: string;
  sourceCaseId: string;
  status: CaseStatus;
  waitingOn: string | null;
  reason: string | null;
  answers: Record<string, unknown> | null;
  costMicroUsd: number;
  charges?: Charges;
  captureKey: string;
};

export type Settings = {
  model: string;
  reasoning: string;
  ocr: boolean;
  timeoutSeconds: number | null;
  toolRetries: number | null;
  sandboxImage: string | null;
  // The sandbox size with a dashboard override applied; null without one.
  sandboxSize?: string | null;
  evals: { onPush: boolean };
  schedules: Record<string, { previews: boolean }>;
};

export type CaseKey = Pick<Deployment, "organizationId" | "agentId"> & {
  caseId: string;
};

export type CaseStatus =
  "running" | "waiting" | "halted" | "completed" | "failed" | "cancelled";

// credit_exhausted: a plan's one-time model credit is used up (spec 16a).
export type SpendVerdict = "ok" | "spending_limit_reached" | "credit_exhausted";

export type CaseEvent = CaseKey &
  (
    | {
        type: "status";
        status: CaseStatus;
        waitingOn: string | null;
        reason: string | null;
        answers: Record<string, unknown> | null;
        error: { code: string; message: string } | null;
        haltReason?: Exclude<SpendVerdict, "ok">;
        // Everything the case has been charged so far (spec 16a), which the
        // spending limit reads from the case index, and its parts, which are
        // metered. The size of the run capture last stored, for storage.
        costMicroUsd?: number;
        charges?: Charges;
        captureBytes?: number;
        // Set when the case waits on an approval, whose own event notifies.
        approvalId?: string;
        // On completion: what an eval suite keeps of the case (doc 09).
        completed?: { input: StartCase["input"]; captureKey: string };
      }
    | {
        type: "mention";
        group: string;
        messageId: string;
        by: string;
        message: string;
      }
    | { type: "approval"; approval: Approval }
    // Fields still waiting for a person's review, after a run settles or a
    // person changes an answer.
    | { type: "review"; fields: string[] }
  );

export type Platform = {
  caseEvent(event: CaseEvent): Promise<void>;
  evalEvent(event: EvalEvent): Promise<void>;
  // The spending limit (design doc 04), asked before each metered model, OCR
  // or decide call.
  spendGate(organizationId: string): Promise<SpendVerdict>;
  ocrFile(file: {
    organizationId: string;
    fileId: string;
  }): Promise<{ markdown: string; pages: number; costMicroUsd: number }>;
  // Before a case's sandbox starts or wakes: the size guardrail as it is now,
  // then the spending limit and plan credit (spec 5 and 16a).
  sandboxGate(
    organizationId: string,
    size: string,
  ): Promise<SpendVerdict | "sandbox_size_not_allowed">;
  // Each sandbox's start, wake, heartbeat, sleep, destroy and crash, which
  // the API times and bills (spec 16a).
  sandboxEvent: SandboxReporter["sandboxEvent"];
  // Run-log records (design doc 09), queued for the API's consumer.
  logs(records: LogRecord[]): Promise<void>;
  // The memory_propose tool (spec 10); the answer is the tool's result.
  proposeMemory(proposal: MemoryProposal): Promise<ProposeResult>;
  // The secrets a deployment's code receives (design doc 03): the version
  // names the current set, asked on every call; the values are read only
  // when an isolate loads.
  secretsVersion(d: DeploymentRef): Promise<string>;
  secretValues(
    d: DeploymentRef,
  ): Promise<{ version: string; values: Record<string, string> }>;
};

export type DeploymentRef = Pick<
  Deployment,
  "organizationId" | "agentId" | "deploymentId"
>;
