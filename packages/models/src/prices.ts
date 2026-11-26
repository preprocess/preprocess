// What our hosted service charges for the fixed-purpose models (spec 16a): our
// cost plus 5%. Only our cloud charges; a self-hosted install's own serving
// URLs are never metered, so callers apply these only in cloud run mode.

export const MARKUP = 1.05;

// groundhog-1 on Baseten's Model APIs: $0.035 per million input tokens and no
// output price (baseten.co/pricing, read 2026-11-26).
export const DECIDE_USD_PER_MTOK = 0.035 * MARKUP;

// LightOn OCR 3 4B runs on our own Baseten deployment, billed per GPU-minute,
// so its cost per page is the GPU's per-minute price over pages per minute.
// Provisional until PRE-29 measures throughput: an L4 ($0.01414 a minute,
// baseten.co/pricing) at about 30 pages a minute.
export const OCR_USD_PER_PAGE = 0.0005 * MARKUP;

export const microUsd = (usd: number) => Math.round(usd * 1_000_000);

export const decideCostMicroUsd = (inputTokens: number) =>
  microUsd((inputTokens / 1_000_000) * DECIDE_USD_PER_MTOK);

export const ocrCostMicroUsd = (pages: number) =>
  microUsd(pages * OCR_USD_PER_PAGE);
