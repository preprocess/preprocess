// Run capture (spec 12a): every case stores its full run, model calls, tool
// calls and results, tokens, cost and timing, in a versioned format in R2.
// Version 1 is one JSON document per case, written when the case ends; while
// it runs, the events live in the case's Durable Object.

export const CAPTURE_FORMAT = "preprocess.run";
export const CAPTURE_VERSION = 1;

export type CaptureEvent = {
  seq: number;
  at: string;
  kind:
    | "case.started"
    | "model.request"
    | "model.response"
    | "model.error"
    | "context.summary"
    | "tool.call"
    | "tool.result"
    | "case.completed"
    | "case.failed"
    | "case.halted"
    | "case.event"
    | "case.wait"
    | "platform.error"
    | "schema.answer"
    | "schema.error"
    | "decide"
    | "ocr";
  data: Record<string, unknown>;
};

export type Usage = { input: number; output: number; costMicroUsd: number };

export type RunCapture = {
  format: typeof CAPTURE_FORMAT;
  version: typeof CAPTURE_VERSION;
  organizationId: string;
  agentId: string;
  deploymentId: string;
  caseId: string;
  sdkVersion: string;
  model: string;
  status: "completed" | "failed";
  usage: Usage;
  events: CaptureEvent[];
};

// Stored files include the organization (spec 15).
export const captureKey = (c: {
  organizationId: string;
  agentId: string;
  caseId: string;
}) =>
  `${c.organizationId}/agents/${c.agentId}/cases/${c.caseId}/run.v${CAPTURE_VERSION}.json`;
