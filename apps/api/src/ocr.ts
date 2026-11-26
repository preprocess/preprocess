// OCR on the platform side (design doc 07): POST /v1/orgs/{org}/ocr and the
// runtime's OCR before a run both read an uploaded file from R2 and send it
// whole, inline, to the OCR model.

import { ocrLimits } from "@preprocess/models/contract";
import { modelEndpoint } from "@preprocess/models/endpoints";
import { ocrDocument } from "@preprocess/models/ocr";
import type { OcrBlock } from "@preprocess/models/ocr";
import { ocrCostMicroUsd } from "@preprocess/models/prices";
import { runMode } from "@preprocess/runmode";
import { withOrg } from "@preprocess/db/client";
import type { OrgId } from "@preprocess/db/client";
import { files } from "@preprocess/db/schema/cases";
import { eq } from "drizzle-orm";

import { ApiError } from "./cases.ts";
import type { Env } from "./env.ts";

export type OcrResult = {
  pages: { index: number; markdown: string; blocks?: OcrBlock[] }[];
  model: string;
  // What our cloud charges for these pages (spec 16a); zero self-hosted.
  costMicroUsd: number;
};

const types = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const dataUrl = (bytes: Uint8Array, contentType: string) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${contentType};base64,${btoa(binary)}`;
};

export const ocrFile = async (
  env: Env,
  org: OrgId,
  fileId: string,
  grounding = false,
): Promise<OcrResult> => {
  const [file] = await withOrg(env, org, (tx) =>
    tx
      .select({ r2Key: files.r2Key, contentType: files.contentType })
      .from(files)
      .where(eq(files.id, fileId)),
  );
  if (!file) throw new ApiError(404, "not_found", "No such file.");
  if (!types.has(file.contentType))
    throw new ApiError(
      415,
      "unsupported_file",
      "OCR takes PDFs and PNG, JPEG or WebP page images.",
    );
  const object = await env.FILES.get(file.r2Key);
  if (!object) throw new ApiError(404, "not_found", "No such file.");
  if (object.size > ocrLimits.bytes)
    throw new ApiError(
      413,
      "file_too_large",
      "OCR takes files up to 50 MB and 1,000 pages.",
    );
  const bytes = new Uint8Array(await object.arrayBuffer());
  const endpoint = modelEndpoint(env, "ocr");
  const read = await ocrDocument(endpoint, {
    document: dataUrl(bytes, file.contentType),
    grounding,
  });
  return {
    pages: read.pages,
    model: read.usage.model,
    costMicroUsd:
      runMode(env).kind === "cloud" ? ocrCostMicroUsd(read.usage.pages) : 0,
  };
};
