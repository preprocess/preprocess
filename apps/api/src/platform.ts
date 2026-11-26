// The API's internal entrypoint for the platform's other Workers. The runtime
// reports case events here (the API is the one writer of the case index),
// OCRs a case's files through it (design doc 04), and reads the secrets agent
// code receives when it loads that code (design doc 03).

import { orgId, withOrg } from "@preprocess/db/client";
import type { LogRecord } from "@preprocess/logs";
import type { SandboxEvent } from "@preprocess/sandbox";
import { WorkerEntrypoint } from "cloudflare:workers";

import { recordCaseEvent } from "./cases.ts";
import { secretsVersion, secretValues, type DeploymentRef } from "./deploy.ts";
import type { CaseEvent } from "./cases.ts";
import type { Env } from "./env.ts";
import { recordEvalEvent } from "./evals.ts";
import type { EvalEvent } from "./evals.ts";
import { sendLogs } from "./logs.ts";
import { proposeMemory, type MemoryProposal } from "./memories.ts";
import { ocrFile } from "./ocr.ts";
import { recordSandboxEvent, sandboxMaxSize, sizeAllowed } from "./sandbox.ts";
import { entitlement } from "./billing.ts";
import { spendGate, type SpendVerdict } from "./spend.ts";
import type { SandboxSize } from "@preprocess/sdk/protocol";

export class Platform extends WorkerEntrypoint<Env> {
  caseEvent(event: CaseEvent) {
    return recordCaseEvent(this.env, event);
  }

  // An eval case settling (design doc 09); it never reaches the case index.
  evalEvent(event: EvalEvent) {
    return recordEvalEvent(this.env, event);
  }

  // The agent's memory_propose tool (spec 10). The answer goes back to the
  // agent as the tool's result.
  proposeMemory(proposal: MemoryProposal) {
    return proposeMemory(this.env, proposal);
  }

  // The runtime calls this before each metered model, OCR or decide call and
  // halts the case with the returned reason when it is not "ok".
  async spendGate(organizationId: string): Promise<SpendVerdict> {
    const org = orgId(organizationId);
    const verdict = await withOrg(this.env, org, (tx) => spendGate(tx));
    if (verdict !== "ok") return verdict;
    // Free's one-time model credit (spec 16a): model usage stops when it is
    // used up, until the organization upgrades. Without a started plan there
    // is no credit at all.
    return (await entitlement(this.env, org, "model_usage")) === "ok"
      ? "ok"
      : "credit_exhausted";
  }

  // A sandbox's start, wake, heartbeat, sleep, destroy or crash (spec 16a),
  // timed here.
  sandboxEvent(event: SandboxEvent) {
    return recordSandboxEvent(this.env, event);
  }

  // Asked before a case's sandbox starts or wakes: the organization's size
  // guardrail as it is now (spec 5), then the spending limit and plan credit,
  // which sandbox time counts toward (spec 16a).
  async sandboxGate(
    organizationId: string,
    size: SandboxSize,
  ): Promise<SpendVerdict | "sandbox_size_not_allowed"> {
    const cap = await withOrg(this.env, orgId(organizationId), sandboxMaxSize);
    if (!sizeAllowed(cap, size)) return "sandbox_size_not_allowed";
    return this.spendGate(organizationId);
  }

  // Run-log records from the runtime and the Tail Worker (design doc 09).
  logs(records: LogRecord[]) {
    return sendLogs(this.env, records);
  }

  async ocrFile(file: { organizationId: string; fileId: string }) {
    const result = await ocrFile(
      this.env,
      orgId(file.organizationId),
      file.fileId,
    );
    return {
      markdown: result.pages.map((p) => p.markdown).join("\n\n"),
      pages: result.pages.length,
      costMicroUsd: result.costMicroUsd,
    };
  }

  // Asked on every call into agent code: a new version loads a fresh isolate,
  // so a rotated or revoked secret takes effect on the next call.
  secretsVersion(deployment: DeploymentRef) {
    return secretsVersion(this.env, deployment);
  }

  // Only while an isolate loads; the values go straight into its env.
  secretValues(deployment: DeploymentRef) {
    return secretValues(this.env, deployment);
  }
}
