// OCR on the platform side (design doc 07): POST /v1/orgs/{org}/ocr and the
// runtime's OCR before a run both read an uploaded file from R2 and send its
// pages to the model service.

import { modelEndpoint } from "@preprocess/models/endpoints";
import { ocrPage } from "@preprocess/models/ocr";
import type { OcrBlock } from "@preprocess/models/ocr";
import { withOrg } from "@preprocess/db/client";
import type { OrgId } from "@preprocess/db/client";
import { files } from "@preprocess/db/schema/cases";
import { eq } from "drizzle-orm";

import { ApiError } from "./cases.ts";
import type { Env } from "./env.ts";

export type OcrResult = {
  pages: { index: number; markdown: string; blocks?: OcrBlock[] }[];
  model: string;
};

// The model takes one page image per request.
const images = new Set(["image/png", "image/jpeg", "image/webp"]);

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
  if (!images.has(file.contentType))
    throw new ApiError(
      415,
      "unsupported_file",
      "OCR takes PNG, JPEG or WebP page images.",
    );
  const object = await env.FILES.get(file.r2Key);
  if (!object) throw new ApiError(404, "not_found", "No such file.");
  const page = await ocrPage(modelEndpoint(env, "ocr"), {
    image: dataUrl(
      new Uint8Array(await object.arrayBuffer()),
      file.contentType,
    ),
    grounding,
  });
  return {
    pages: [
      {
        index: 0,
        markdown: page.markdown,
        ...(page.blocks && { blocks: page.blocks }),
      },
    ],
    model: page.usage.model,
  };
};
