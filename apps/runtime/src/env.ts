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
  LOCAL_NAMESPACE?: Fetcher;
  // The API Worker's internal entrypoint: the one writer of the case index,
  // and the OCR service for files (design doc 04). Unbound in the runtime's
  // own tests, where reports are only captured.
  PLATFORM?: Platform;
};

export type NetworkRules = { allow: string[]; block: string[] };

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
};

export type CaseKey = Pick<Deployment, "organizationId" | "agentId"> & {
  caseId: string;
};

export type CaseStatus =
  "running" | "waiting" | "completed" | "failed" | "cancelled";

export type CaseEvent = CaseKey &
  (
    | {
        type: "status";
        status: CaseStatus;
        waitingOn: string | null;
        reason: string | null;
        answers: Record<string, unknown> | null;
        error: { code: string; message: string } | null;
      }
    | {
        type: "mention";
        group: string;
        messageId: string;
        by: string;
        message: string;
      }
  );

export type Platform = {
  caseEvent(event: CaseEvent): Promise<void>;
  ocrFile(file: {
    organizationId: string;
    fileId: string;
  }): Promise<{ markdown: string }>;
};
