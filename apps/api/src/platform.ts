// The API's internal entrypoint for the platform's other Workers. The runtime
// reports case events here (the API is the one writer of the case index) and
// OCRs a case's files through it (design doc 04).

import { orgId } from "@preprocess/db/client";
import { WorkerEntrypoint } from "cloudflare:workers";

import { recordCaseEvent } from "./cases.ts";
import type { CaseEvent } from "./cases.ts";
import type { Env } from "./env.ts";
import { ocrFile } from "./ocr.ts";

export class Platform extends WorkerEntrypoint<Env> {
  caseEvent(event: CaseEvent) {
    return recordCaseEvent(this.env, event);
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
