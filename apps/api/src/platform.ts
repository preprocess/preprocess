// The API's internal entrypoint for the platform's other Workers. The runtime
// reports case events here (the API is the one writer of the case index),
// OCRs a case's files through it (design doc 04), and reads the secrets agent
// code receives when it loads that code (design doc 03).

import { orgId, withOrg } from "@preprocess/db/client";
import type { LogRecord } from "@preprocess/logs";
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
import { spendGate } from "./spend.ts";

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
  spendGate(organizationId: string) {
    return withOrg(this.env, orgId(organizationId), (tx) => spendGate(tx));
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
