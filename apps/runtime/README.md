# Runtime

The agent runtime (spec 15, layout B from PRE-28): Pi Durable
(`@earendil-works/pi-durable` 1.6.0 through the Agents SDK's `PiHarness`) in our
own Durable Object, `CaseRuntime`, one per organization, agent and case
(`<org>:<agent>:<case>`). The agent's code runs beside it as a Dynamic Worker
(design doc 03): the deployment's bundle from `BUNDLES`, checked against the
SHA-256 the deploy recorded and loaded by the Worker Loader into its own
isolate, named `<org>:<agent>:<deployment>:<secrets version>:<rules>`. The
runtime reads its manifest (`@preprocess/sdk/protocol`) when a case starts and
calls it for each tool call. Its `globalOutbound` is the runtime's `Outbound`
entrypoint, which applies the organization's network rules, and its console
output goes to `apps/tail`.

- **Models** come from `MODEL_SERVICE_URL` (OpenAI-compatible), which is the
  stub in `apps/model-stub` locally and in tests (design doc 07).
- **Secrets** are decrypted by the API, never here: this Worker has no key. Each
  call asks the API for the deployment's secrets version; only when a new
  isolate loads does it read the values, which go straight into that isolate's
  `env` and nowhere else. A rotated or revoked secret moves the version, so the
  next call loads a fresh isolate. The SDK redacts values from what comes back.
- **Limits**: Cloudflare throws past 10 distinct Dynamic Workers in flight per
  Durable Object (4 per request), so calls past that wait for a slot. CPU is
  bounded by the case's `timeoutSeconds`, not by Dynamic Worker limits.
- **Run capture** (spec 12a): every model request and response (with token usage
  and timing), tool call and result, and the case's outcome is recorded in the
  object as it happens, then sealed as `preprocess.run` version 1 in the `RUNS`
  bucket at `<org>/agents/<agent>/cases/<case>/run.v1.json`.
- **RPC**: `startCase`, `getCase`, `manifest` and `putBundle` on the default
  entrypoint, called by the API Worker.

Worker Loader runs in Cloudflare's local runtime, so `pnpm dev` and the tests
load agent code exactly as a deployed stage does. Locally it does not enforce
the concurrency limit, so the runtime's own guard is what keeps to it.

Not yet: the spec's change to Pi so context is handled with large summaries
instead of progressive compaction, and reasoning levels on the model call.
