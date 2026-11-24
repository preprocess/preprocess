// The API's internal entrypoint for the platform's other Workers. The runtime
// reports case events here (the API is the one writer of the case index) and
// OCRs a case's files through it (design doc 04).

import { orgId, withOrg } from "@preprocess/db/client";
import type { LogRecord } from "@preprocess/logs";
import { WorkerEntrypoint } from "cloudflare:workers";

import { recordCaseEvent } from "./cases.ts";
import type { CaseEvent } from "./cases.ts";
import type { Env } from "./env.ts";
import { recordEvalEvent } from "./evals.ts";
import type { EvalEvent } from "./evals.ts";
import { sendLogs } from "./logs.ts";
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
    return { markdown: result.pages.map((p) => p.markdown).join("\n\n") };
  }
}
