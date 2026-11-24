import { callModel, type CallOptions, type ModelEndpoint } from "./client.ts";
import { chatCompletion, type OcrRequest } from "./contract.ts";

export type OcrBlock = {
  label: string;
  // [x0, y0, x1, y1], normalized to 0–1000 of the page's width and height.
  bbox: [number, number, number, number];
  text: string;
};

export type OcrPageResult = {
  markdown: string;
  blocks?: OcrBlock[];
  usage: { model: string; inputTokens: number; outputTokens: number };
};

// Grounding output, one block after another:
//
//   <|block|>{"label":"title","bbox":[40,32,610,88]}
//   # Invoice 1042
//
// Each marker line carries the block's label and box; the text up to the next
// marker is the block's Markdown. This follows our reading of the model card
// and has not been checked against a real LightOn OCR 3 4B response;
// apps/model-stub emits the same format.
const marker = "<|block|>";

export function parseGrounding(content: string): {
  markdown: string;
  blocks: OcrBlock[];
} {
  const blocks: OcrBlock[] = [];
  for (const chunk of content.split(marker).slice(1)) {
    const newline = chunk.indexOf("\n");
    const head = newline === -1 ? chunk : chunk.slice(0, newline);
    const text = newline === -1 ? "" : chunk.slice(newline + 1).trim();
    try {
      const { label, bbox } = JSON.parse(head) as {
        label?: unknown;
        bbox?: unknown;
      };
      if (
        typeof label === "string" &&
        Array.isArray(bbox) &&
        bbox.length === 4 &&
        bbox.every((n) => typeof n === "number")
      )
        blocks.push({
          label,
          bbox: bbox as OcrBlock["bbox"],
          text,
        });
    } catch {
      // A malformed marker line is skipped; its text stays out of the blocks.
    }
  }
  if (blocks.length === 0) return { markdown: content.trim(), blocks };
  return { markdown: blocks.map((b) => b.text).join("\n\n"), blocks };
}

export const renderGrounding = (blocks: OcrBlock[]) =>
  blocks
    .map(
      (block) =>
        `${marker}${JSON.stringify({ label: block.label, bbox: block.bbox })}\n${block.text}`,
    )
    .join("\n\n");

// One page image (a PNG, JPEG or WebP data URL) to Markdown, and to labelled
// blocks with grounding.
export async function ocrPage(
  endpoint: ModelEndpoint,
  { image, grounding = false }: { image: string; grounding?: boolean },
  call: CallOptions = {},
): Promise<OcrPageResult> {
  const request: OcrRequest = {
    model: endpoint.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: image } },
          { type: "text", text: grounding ? "grounding" : "" },
        ],
      },
    ],
  };
  const response = await callModel(
    endpoint,
    "/v1/chat/completions",
    request,
    chatCompletion,
    call,
  );
  const content = response.choices[0]?.message.content ?? "";
  const usage = {
    model: response.model,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  };
  if (!grounding) return { markdown: content.trim(), usage };
  return { ...parseGrounding(content), usage };
}
