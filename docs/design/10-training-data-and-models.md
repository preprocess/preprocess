# 10. Training data and models (spec 12a, the parts that ship now)

Covers PRE-130 (run-capture read and export), PRE-131 (datasets), PRE-132 (registering a model by endpoint, checkpoints), PRE-133 (the training switch) and PRE-134 (the model catalog and per-organization endpoints). Hosted training runs, Retrain on corrections, the Tinker-compatible API and fine-tune serving stay Coming soon (501 coming_soon) and nothing here calls preprocess/models' served models.

Everything below is open source platform code (spec 12a, "Open source versus our service") and uses only what a self-hosted install has: Postgres, the existing RUNS and FILES buckets, Queues. No new Cloudflare resource is needed.

## 1. Training switch (PRE-133)

One install-level switch, read in one place: `trainingEnabled(env)` in `apps/api/src/training.ts`.

- Our cloud (`runMode(env).kind === "cloud"`): always on. The variable is ignored.
- Self-hosted: `TRAINING_SERVICE` must be `"on"` to turn it on; unset or anything else is off. Declared in `infra/src/stages.ts` / `alchemy.run.ts` for selfhost stages only, default unset.

Effect today, because the service itself is Coming soon:
- On: `POST /training/runs`, `POST /agents/{agent}/retrain` and `/training/tinker/*` answer 501 coming_soon (as now).
- Off: the same routes answer 404 not_found ("hidden"), and they leave the OpenAPI document's Training tag described as off.
- `GET /v1/orgs/{org}/training` (any member) returns `{ service: "on" | "off", runs: "coming_soon" }` so the app and CLI hide or label Training features. Capture, datasets, export, environments, evals and model registration never read the switch: they work either way.

## 2. Run capture read and export (PRE-130)

Capture stays where it is: one versioned JSON document per case in the runtime's RUNS bucket (`apps/runtime/src/capture.ts`, format `preprocess.run` v1). The API reads it through a new Runtime RPC, `readCapture(c: CaseKey): Promise<RunCapture | null>` (R2 get on `captureKey(c)`), not by binding RUNS to the API, so there is still one owner of that bucket.

Routes (`apps/api/src/routes/capture.ts`, tag Training):
- `GET /cases/{case}/capture`: the case's run capture as stored. Who: anyone who can see the case (`canSeeCase`). 404 when the case is unknown or not visible; 409 `capture_not_ready` while the case is still running; 410 `capture_purged` when retention deleted it (`cases.capturePurgedAt`).
- `GET /cases/{case}/review-events`: the case's review events in order (kind, path, before, after, checks, userId, at). Same access rule.
- `GET /agents/{agent}/capture/export`: NDJSON stream, one line per closed case `{ case: {id, status, createdAt, completedAt, deploymentId, model}, capture, reviewEvents }`, filtered by `from`, `to` (createdAt), `status`, paged by a `cursor` + `limit` (max 500) and a `next` cursor in a trailing `{ "next": "..." }` line. Who: Developers (`requireDeveloper`) or an API key. Each export writes one audit event `capture.exported` (agent, filters, count). Cases whose capture is purged are skipped and counted in the trailer.

The capture reader (case lookup + RPC + review events) is one module, `apps/api/src/capture.ts`, which datasets reuse.

## 3. Datasets (PRE-131)

A dataset is a saved query over one agent's cases, not a copy of data. Table `datasets` (expand-only migration):

```
datasets(id text pk, organization_id, agent_id, name text, query jsonb, created_by text, created_at, updated_at,
  unique(organization_id, id), unique(organization_id, agent_id, name), fk (organization_id, agent_id) -> agents)
```
RLS on organization_id like every org table.

`query` (zod, versioned by shape): `{ from?: ISO, to?: ISO, status?: ("completed"|"failed"|"halted"|"cancelled")[], deployments?: string[], edited?: { any: true } | { fields: string[] } | { none: true }, outcome?: "corrected"|"accepted" }` where corrected = at least one review event of kind edit, accepted = completed with none. Only closed cases are ever included.

Routes (`apps/api/src/routes/datasets.ts`, tag Training; Developers or API key to write, anyone who can see the agent's cases to read):
- `GET/POST /agents/{agent}/datasets`, `GET/PATCH/DELETE /agents/{agent}/datasets/{dataset}`. Audit `dataset.created|updated|deleted`.
- `GET /agents/{agent}/datasets/{dataset}/preview?limit=20`: `{ count, cases: [{ id, title, status, completedAt, editedFields }] }`.
- `GET /agents/{agent}/datasets/{dataset}/export?format=sft|preference|replay`: NDJSON, paged like capture export, audit `dataset.exported` (format, count).
  - sft: `{ case, messages }`, the model conversation from capture (model.request/response) with the final answer replaced by the human-corrected answers.
  - preference: `{ case, prompt, chosen, rejected }`, only cases with an edit: chosen = corrected answers, rejected = the agent's answers. Cases without an edit are skipped.
  - replay: `{ case, capture, reviewEvents }` (same line as capture export), which an environment replays.
- A customer's data only ever exports to that customer (RLS + org-scoped key); no cross-org pooling exists.

## 4. Model catalog and registered endpoints (PRE-134 + PRE-132)

One table serves both "serve a catalog model from our own URL" (self-hosted, PRE-134) and "register a model by endpoint", which is how a checkpoint becomes a model (PRE-132):

```
model_endpoints(id text pk, organization_id, model text,          -- a catalog id (kimi-k3.1-pro ...) or an org model id "org:<slug>"
  kind text check in ('override','model'),                          -- override: serves a catalog model; model: a new org model
  label text, base_model text null,                                 -- model kind: shown name and the catalog model it was trained from (prices/compat)
  url text, provider_model text,                                    -- OpenAI-compatible base URL (https only) and the name sent as "model"
  key_version int null, key_ciphertext bytea null,                  -- API key, envelope-encrypted with the org key (crypto.ts, like secrets)
  checkpoint text null,                                             -- free-form source, e.g. "tinker://run/123/step-400" or an HF repo
  created_by, created_at, updated_at,
  unique(organization_id, model))
```
Expand-only migration, RLS on organization_id.

Resolution order (`packages/models` `modelRoute` already has the slot): organization endpoint, then the install's MODEL_ENDPOINTS, then the provider key or binding, then MODEL_SERVICE_URL (stub; previews and staging only). The runtime gets an org's endpoints through a Platform RPC at case start (decrypted in the API Worker, never written to DO storage, capture or logs; capture records the model id and endpoint id only).

Catalog API (`apps/api/src/routes/models.ts`, tag Models):
- `GET /models` (any member): every catalog model `{ id, label, kind: "catalog", serving: "baseten"|"workers-ai"|"endpoint"|"install", allowed, trainable }` plus every org model `{ id: "org:<slug>", kind: "model", label, baseModel, checkpoint, serving: "endpoint", allowed }`. Keys are never returned, only `hasKey`.
- `POST /models/endpoints`, `PATCH /models/endpoints/{id}`, `DELETE /models/endpoints/{id}`: Owner or Admin (an endpoint is where case data is sent). Audit `model_endpoint.created|updated|deleted` (no key in the data). `POST /models/endpoints/{id}/test` sends one tiny chat completion and returns ok/status/latency.
- Deleting an org model that a deployment, setting or eval run still names is refused 409 `model_in_use`.
- `GET /guardrails` `modelEndpoints` becomes `{ kind: "hosted" | "own", endpoints: [{ model, url host only }] }` instead of the literal "hosted".

Using org models (PRE-132): everywhere a model is validated today (`deploy.ts` manifest model, `settings.ts` model, eval runs' `models`, allowed-models guardrail) accepts a catalog id or an `org:<slug>` that exists in the org. A preview deployment pins one through config or a settings override; eval runs already take up to five models, so a suite compares it with the current model; promotion is the existing promote. The allowed-models guardrail lists org models like catalog models (unset still allows all). The SDK protocol gets `isOrgModel(id)`; `MODEL_CATALOG` stays the built-in list.

Pricing (spec 16a: models at provider cost plus 5%): a call that goes to an organization's own endpoint carries zero model charge, both for every `org:<slug>` model, with or without a base model, and for a catalog override the organization registered. Their endpoint, their bill. `baseModel` is metadata only. Calls through our providers or Workers AI keep the catalog price. Case fees, decide, OCR and the other meters apply as usual. Priced in the runtime (`priceOf` in `apps/runtime/src/models.ts`), which also never applies the Fast reprice to an endpoint's response. Recorded in `metering.ts`.

## 5. UI (after Design, PLAT-44)

Models page (catalog + register endpoint, Owner/Admin), Datasets (per agent: list, query builder, preview, export), and the agent Training tab (datasets, capture export, Coming soon training runs, hidden when the switch is off). Built only from a PLAT-44 handoff under handoffs/training/.

## PR order

1. PRE-133 switch + this doc. 2. PRE-130 capture read/export. 3. PRE-131 datasets (on 2). 4. PRE-134 catalog + endpoints (table, routes, runtime routing for overrides). 5. PRE-132 org models in deploy/settings/evals/metering (on 4). 6–7. UI.
