# Runtime

The agent runtime (spec 15, layout B from PRE-28): Pi Durable
(`@earendil-works/pi-durable` 1.6.0 through the Agents SDK's `PiHarness`) in our
own Durable Object, `CaseRuntime`, one per organization, agent and case
(`<org>:<agent>:<case>`). The agent's code is never loaded here. The runtime
reads the deployed Worker's manifest (`@preprocess/sdk/protocol`) when a case
starts and calls it statelessly through the dispatch namespace for each tool
call, with the organization's network rules as outbound parameters.

- **Models** come from `MODEL_SERVICE_URL` (OpenAI-compatible), which is the
  stub in `apps/model-stub` locally and in tests (design doc 07).
- **Secrets** never reach this Worker. It has no secret bindings and no key to
  decrypt them; values are bound only to the agent's Worker, and the SDK redacts
  them from what comes back.
- **Run capture** (spec 12a): every model request and response (with token usage
  and timing), tool call and result, and the case's outcome is recorded in the
  object as it happens, then sealed as `preprocess.run` version 1 in the `RUNS`
  bucket at `<org>/agents/<agent>/cases/<case>/run.v1.json`.
- **RPC**: `startCase`, `getCase` and `manifest` on the default entrypoint,
  called by the API Worker.

Locally, Cloudflare's runtime cannot emulate a dispatch namespace, so
`apps/namespace-local` stands in for it and `apps/outbound` applies the network
rules; `pnpm dev` starts all of them.

Not yet: the spec's change to Pi so context is handled with large summaries
instead of progressive compaction, and reasoning levels on the model call.
