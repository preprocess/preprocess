import acmeInvoice from "./2d95a627992d4708970bc90604baef4d1c95de4f3ab61d9769a350d0a51f0a7a.json";

// OCR answers for the sample documents, keyed by the SHA-256 of the page
// image the platform sends. Add a sample under samples/, write its answer as
// <sha256>.json, and list it here.
// Boxes are [x0, y0, x1, y1] on a 0–1000 scale of the page.
type OcrFixture = {
  markdown: string;
  blocks?: Array<{ label: string; bbox: number[]; text: string }>;
};

export const ocrFixtures: Record<string, OcrFixture | undefined> = {
  "2d95a627992d4708970bc90604baef4d1c95de4f3ab61d9769a350d0a51f0a7a":
    acmeInvoice,
};
