import type { ChatCompletion, OcrRequest } from "@preprocess/models/contract";
import { type OcrBlock, renderGrounding } from "@preprocess/models/ocr";

import { ocrFixtures } from "../fixtures/ocr/index.ts";

const sha256 = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

export async function ocr(request: OcrRequest): Promise<ChatCompletion> {
  const [{ content }] = request.messages;
  const [image, { text: mode }] = content;
  const base64 = image.image_url.url.slice(
    image.image_url.url.indexOf(",") + 1,
  );
  const digest = await sha256(
    Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
  );

  const fixture = ocrFixtures[digest];
  const markdown =
    fixture?.markdown ??
    `# Stub OCR\n\nPage text is not available without the OCR model (image ${digest.slice(0, 12)}).`;
  const blocks: OcrBlock[] = (
    fixture?.blocks ?? [
      { label: "text", bbox: [0, 0, 1000, 1000], text: markdown },
    ]
  ).map(({ label, bbox: [x0 = 0, y0 = 0, x1 = 0, y1 = 0], text }) => ({
    label,
    bbox: [x0, y0, x1, y1],
    text,
  }));
  const output = mode === "grounding" ? renderGrounding(blocks) : markdown;

  return {
    id: `chatcmpl-stub-${digest.slice(0, 16)}`,
    object: "chat.completion",
    created: 0,
    model: "stub-lightonocr",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: output },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: Math.ceil(base64.length / 1000),
      completion_tokens: Math.ceil(output.length / 4),
      total_tokens:
        Math.ceil(base64.length / 1000) + Math.ceil(output.length / 4),
    },
  };
}
