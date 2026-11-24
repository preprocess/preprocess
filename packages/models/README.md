# @preprocess/models

The platform's model client (design doc 07). The API and runtime Workers call
the decision model (Groundhog-1, Baseten's System One API at `/v1/systemone`)
and the OCR model (LightOn OCR 3 4B, OpenAI chat completions as vLLM serves it)
through this package, whatever is behind the URL: `apps/model-stub` locally and
on previews, our model service later, or a self-hoster's own endpoint.

- `./endpoints`: `modelEndpoint` picks the URL, key and model for a purpose. An
  organization's registered endpoint wins; otherwise `MODEL_SERVICE_URL` and
  `MODEL_SERVICE_KEY`. With neither it throws `model_unavailable` (503) and
  never falls back to a stub.
- `./decide`: `decide` asks one `choice` question and returns the top `keep`
  options with probabilities. Lists over 255 options run in parallel rounds.
- `./ocr`: `ocrPage` reads one page image as Markdown, with labelled blocks in
  grounding mode.
- `./contract`: the Zod schemas for both wire formats, shared with the stub so
  it validates exactly what the client sends.
- `./client`: the HTTP call, timeouts and `ModelError`.

Every result carries `usage` (the model that answered and its input tokens) for
metering. The grounding output format of LightOn OCR 3 4B has not been checked
against a real response yet; `parseGrounding` and the stub's fixtures follow the
format documented in `src/ocr.ts`.
