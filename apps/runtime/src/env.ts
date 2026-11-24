import type { LogRecord } from "@preprocess/logs";

import type { Approval } from "./approvals.ts";
import type { CaseRuntime } from "./case-runtime.ts";

export type Env = {
  STAGE: string;
  MODEL_SERVICE_URL?: string;
  MODEL_SERVICE_KEY?: string;
  CASE_RUNTIME: DurableObjectNamespace<CaseRuntime>;
  RUNS: R2Bucket;
  // Deployed stages bind the stage's dispatch namespace. Cloudflare's local
  // runtime cannot emulate one, so local dev and tests bind
  // apps/namespace-local instead.
  DISPATCHER?: DispatchNamespace;
  LOCAL_NAMESPACE?: LocalNamespace;
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

// apps/namespace-local: dispatch with props, as a dispatch namespace does.
export type LocalNamespace = {
  dispatch(
    script: string,
    outbound: { organizationId: string; network: string },
    props: Record<string, unknown>,
    request: Request,
  ): Promise<Response>;
};

// What the runtime needs to know about the deployment a case runs on. The
// platform's deployment record supplies it; agent code never does.
export type Deployment = {
  organizationId: string;
  agentId: string;
  deploymentId: string;
  script: string;
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

export type CaseFile = { id: string; name: string; contentType: string };

export type StartCase = Deployment & {
  caseId: string;
  input: { text: string; files?: CaseFile[] };
  groups?: GroupRef[];
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
  captureKey: string;
};

export type Settings = {
  model: string;
  reasoning: string;
  ocr: boolean;
  timeoutSeconds: number | null;
  toolRetries: number | null;
  sandboxImage: string | null;
  evals: { onPush: boolean };
  schedules: Record<string, { previews: boolean }>;
};

export type CaseKey = Pick<Deployment, "organizationId" | "agentId"> & {
  caseId: string;
};

export type CaseStatus =
  "running" | "waiting" | "halted" | "completed" | "failed" | "cancelled";

export type SpendVerdict = "ok" | "spending_limit_reached";

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
  }): Promise<{ markdown: string }>;
  // Run-log records (design doc 09), queued for the API's consumer.
  logs(records: LogRecord[]): Promise<void>;
};
