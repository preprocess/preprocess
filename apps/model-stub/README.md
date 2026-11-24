# Model stub

A deterministic stand-in for the model service (design doc 07), used locally, in
tests and in previews. It is selected only by `MODEL_SERVICE_URL`; platform code
is the same whether it talks to the stub or a real service. Never deploy it to
production.

`POST /v1/chat/completions` speaks the OpenAI chat-completions shape the agent
models are served with, streaming or not, and requires a bearer token (any
non-empty value). Answers come from `fixtures/chat.json`: the first fixture
whose `match` appears in the conversation's first user message plays its `turns`
in order, one per assistant message so far. A turn either calls tools or
answers; `{{results}}` in an answer is replaced with the tool results the
conversation holds. Without a matching fixture the stub answers with a fixed
sentence and calls nothing. Usage is reported with zero cost.

Tests and seeded failure states can send `x-stub-fail: 429 | 500 | 503` or
`x-stub-latency-ms`. Platform code never sends them.

`/v1/systemone` (`decide`) and OCR arrive with build step 3.
