import type { OcrRequest, OcrResponse } from "@preprocess/models/contract";

import { ocrFixtures } from "../fixtures/ocr/index.ts";

const sha256 = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

// A PDF's page count from its page objects; an image is one page.
const pageCount = (bytes: Uint8Array, pdf: boolean) =>
  pdf
    ? Math.max(
        1,
        new TextDecoder("latin1").decode(bytes).match(/\/Type\s*\/Page(?!s)/g)
          ?.length ?? 0,
      )
    : 1;

// Mistral's OCR response for one document: every page answers from the
// fixture for the document's SHA-256, or with placeholder text. Fixture boxes
// are on a 0–1000 scale, so pages are 1000 by 1000 pixels.
export async function ocr(request: OcrRequest): Promise<OcrResponse> {
  const { document } = request;
  const url =
    document.type === "document_url"
      ? document.document_url
      : document.image_url;
  const bytes = Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) =>
    c.charCodeAt(0),
  );
  const digest = await sha256(bytes);
  const fixture = ocrFixtures[digest];
  const markdown =
    fixture?.markdown ??
    `# Stub OCR\n\nPage text is not available without the OCR model (document ${digest.slice(0, 12)}).`;
  const blocks = (
    fixture?.blocks ?? [
      { label: "text", bbox: [0, 0, 1000, 1000], text: markdown },
    ]
  ).map(({ label, bbox: [x0 = 0, y0 = 0, x1 = 0, y1 = 0], text }) => ({
    type: label,
    content: text,
    top_left_x: x0,
    top_left_y: y0,
    bottom_right_x: x1,
    bottom_right_y: y1,
  }));
  const count = pageCount(bytes, document.type === "document_url");
  return {
    model: "stub-mistral-ocr",
    pages: Array.from({ length: count }, (_, index) => ({
      index,
      markdown,
      dimensions: { dpi: 200, width: 1000, height: 1000 },
      ...(request.include_blocks && { blocks }),
    })),
    usage_info: { pages_processed: count, doc_size_bytes: bytes.length },
  };
}
