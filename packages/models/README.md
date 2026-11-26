# @preprocess/models

The platform's model client (design doc 07). The API and runtime Workers call
the decision model (groundhog-1, Baseten's System One API at `/v1/systemone`)
and OCR (Mistral OCR 4.1, Mistral's `/v1/ocr`) through this package, and the
runtime routes the agent models with the same resolver.

- `./endpoints`: `ROUTES` names each model's provider and the provider's own
  model name; `modelRoute` resolves where a model is served. An organization's
  registered endpoint wins, then the install's `MODEL_ENDPOINTS` entry for the
  model, then its provider (`BASETEN_API_KEY`, `MISTRAL_API_KEY`, or the Workers
  AI `AI` binding for Qwen), then `MODEL_SERVICE_URL` (the stub in development,
  previews and tests). With none of them it throws `model_unavailable` (503).
- `./decide`: `decide` asks one `choice` question and returns the top `keep`
  options with probabilities. Lists over 255 options run in parallel rounds.
- `./ocr`: `ocrDocument` reads a PDF or page image, sent inline as a base64 data
  URL, as Markdown per page, with labelled blocks in grounding mode.
- `./contract`: the Zod schemas for both wire formats, shared with the stub so
  it validates exactly what the client sends.
- `./client`: the HTTP call, timeouts and `ModelError`.
- `./prices`: what our cloud charges for decide and OCR.

Every result carries `usage` for metering: input tokens for decide, pages
processed for OCR. Mistral's block coordinates are read as pixels of the page's
`dimensions` and normalized to 0–1000; that has not been checked against a real
response yet.
