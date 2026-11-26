// What our hosted service charges for the fixed-purpose models (spec 16a): the
// provider's list price plus 5%. Only our cloud charges; a self-hosted
// install's own serving URLs are never metered, so callers apply these only in
// cloud run mode.

export const MARKUP = 1.05;

// groundhog-1 on Baseten's Model APIs: $0.035 per million input tokens and no
// output price (baseten.co/pricing, read 2026-11-26).
export const DECIDE_USD_PER_MTOK = 0.035 * MARKUP;

// Mistral OCR 4.1 on Mistral's global API: $4 per 1,000 pages
// (docs.mistral.ai/inference/pricing, read 2026-11-26).
export const OCR_USD_PER_PAGE = (4 / 1000) * MARKUP;

export const microUsd = (usd: number) => Math.round(usd * 1_000_000);

export const decideCostMicroUsd = (inputTokens: number) =>
  microUsd((inputTokens / 1_000_000) * DECIDE_USD_PER_MTOK);

export const ocrCostMicroUsd = (pages: number) =>
  microUsd(pages * OCR_USD_PER_PAGE);
