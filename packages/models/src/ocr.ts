import { callModel, type CallOptions, type ModelEndpoint } from "./client.ts";
import { type OcrRequest, ocrResponse } from "./contract.ts";

export type OcrBlock = {
  label: string;
  // [x0, y0, x1, y1], normalized to 0–1000 of the page's width and height.
  bbox: [number, number, number, number];
  text: string;
};

export type OcrResult = {
  pages: { index: number; markdown: string; blocks?: OcrBlock[] }[];
  usage: { model: string; pages: number };
};

// A long document takes Mistral well past the default model timeout.
const OCR_TIMEOUT_MS = 300_000;

const scale = (value: number, size: number | undefined) =>
  size ? Math.round((value / size) * 1000) : Math.round(value);

// One document, a PDF or a page image as a base64 data URL, to Markdown per
// page, and with grounding to labelled blocks per page. Mistral bills every
// page it processed, which usage reports.
export async function ocrDocument(
  endpoint: ModelEndpoint,
  { document, grounding = false }: { document: string; grounding?: boolean },
  call: CallOptions = {},
): Promise<OcrResult> {
  const request: OcrRequest = {
    model: endpoint.model,
    document: document.startsWith("data:application/pdf")
      ? { type: "document_url", document_url: document }
      : { type: "image_url", image_url: document },
    include_blocks: grounding,
    include_image_base64: false,
  };
  const response = await callModel(endpoint, "/v1/ocr", request, ocrResponse, {
    timeoutMs: OCR_TIMEOUT_MS,
    ...call,
  });
  return {
    pages: response.pages.map((page) => {
      const markdown = page.markdown.trim();
      if (!grounding) return { index: page.index, markdown };
      const { width, height } = page.dimensions ?? {};
      const blocks = (page.blocks ?? []).flatMap((block) =>
        block.content
          ? [
              {
                label: block.type ?? "text",
                bbox: [
                  scale(block.top_left_x, width),
                  scale(block.top_left_y, height),
                  scale(block.bottom_right_x, width),
                  scale(block.bottom_right_y, height),
                ] as OcrBlock["bbox"],
                text: block.content,
              },
            ]
          : [],
      );
      return { index: page.index, markdown, blocks };
    }),
    usage: {
      model: response.model,
      pages: response.usage_info.pages_processed,
    },
  };
}
