# Model stub

A deterministic stand-in for the model service (design doc 07), used locally, in
tests and in previews. It is selected only by `MODEL_SERVICE_URL`; platform code
is the same whether it talks to the stub or a real service. Never deploy it to
production.

Every `/v1` route requires a bearer token (any non-empty value).

- `POST /v1/systemone` answers `decide` (groundhog-1), and `POST /v1/ocr`
  answers OCR in Mistral's shape (one page per page object of a PDF), both from
  fixtures under `fixtures/` (design doc 07).
- `POST /v1/chat/completions` with one of the agent models, by its provider's
  name (`ROUTES` in `packages/models/src/endpoints.ts`), plays an agent's turns,
  streaming or not. Agent answers come from `fixtures/chat.json`: the first
  fixture whose `match` appears in the conversation's first user message plays
  its `turns` in order, one per assistant message so far. A turn either calls
  tools or answers; `{{results}}` in an answer is replaced with the tool results
  the conversation holds. Without a matching fixture the stub answers with a
  fixed sentence and calls nothing. Usage is reported with zero cost, and the
  conversation up to the last assistant message counts as cached prompt tokens,
  as the providers report them. Previews and staging send every model here
  (infra/src/stages.ts `callsRealModels`).

Tests and seeded failure states can send `x-stub-fail: 429 | 500 | 503` or
`x-stub-latency-ms`. Platform code never sends them.
