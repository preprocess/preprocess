# Design docs

Design decisions for Preprocess's build steps: accounts and data (step 1), the agent runtime and deploys (step 2), cases (step 3), logs and evals (step 6), and training data and models (step 7). Each doc gives the decision, the schema or API shapes in TypeScript or SQL, the alternatives considered and rejected, and the settled points that shaped it. Implementation pull requests should link the doc they follow and update it when the design changes.

| Doc | Step | Decision in one line |
| --- | --- | --- |
| [01-postgres-schema.md](01-postgres-schema.md) | 1 | Better Auth owns identity tables; our Drizzle schema owns groups, grants, secrets, the case index with assignees, and audit; RLS keyed on a transaction-local `app.org_id`; Owners and Admins see every case and can assign, but working a case needs an operator group |
| [02-audit-chain.md](02-audit-chain.md) | 1 | Append-only and hash-chained per organization, written in the same transaction as the action, with daily signed manifests (even on empty days) in R2 under a one-year lock, and a narrow purge of a deleted organization's events once their lock ends |
| [03-secret-delivery.md](03-secret-delivery.md) | 2 | Agent code runs as Dynamic Workers; secrets enter each isolate's `env` at load, keyed by a secrets version so rotation and revocation apply on the next call; MCP OAuth tokens (organization connections only) go through a platform token service and never reach customer code |
| [04-case-api.md](04-case-api.md) | 3 | One `POST /v1/orgs/{org}/cases` taking files, text or both; 202 with `Idempotency-Key`; schedules off on previews unless configured, pauses survive deploys; assignment by API or Admin; spending limit (calendar month, hosted usage only) and cloud credit as separate stops; halted cases restart by Rerun |
| [05-schema-engine.md](05-schema-engine.md) | 3 | Fields are SDK functions evaluated in the customer's Worker; reads record dependencies; answers flat in the case Durable Object; a rerun never refills a person's answer and suggests beside it instead |
| [06-groups-notifications-webhooks.md](06-groups-notifications-webhooks.md) | 3 | A deploy fails on a group without access; people reference groups, never people; inbox plus immediate email for tags, waits and assignments with one per-person off switch; Standard Webhooks delivery through a Queue |
| [08-github-app.md](08-github-app.md) | 2 | Push builds run in a fresh Cloudflare Container per build, installed by the repository's lockfile and bundled with the CLI's `bundle()`, one at a time per agent and branch with the newest push winning; the installation token fetches the tarball outside the sandbox and is revoked after use |
| [09-logs-and-evals.md](09-logs-and-evals.md) | 6 | Every producer logs through one queue into R2 (a Pipelines stream into an R2 Data Catalog table, NDJSON objects locally) with summaries in Postgres and optional OTLP export; completed cases form an automatic suite of the newest 100, replayed per deployment and model with side-effect tools answered from capture and scored field by field |
| [10-training-data-and-models.md](10-training-data-and-models.md) | 7 | Capture read and export, datasets as saved queries over an agent's cases, and models registered by endpoint, all open source on what a self-hosted install has; training runs stay Coming soon behind one install switch, always on in our cloud and `TRAINING_SERVICE=on` when self-hosted |
| [07-model-service-stub.md](07-model-service-stub.md) | 3 | Until hosted models exist, `decide` and OCR call `apps/model-stub`, which speaks `/v1/systemone` and OpenAI chat completions with deterministic, fixture-driven answers, selected only by `MODEL_SERVICE_URL` |

Not covered here: approvals and scoped access for approval groups (step 4) and the self-hosting installer.

## Open questions

None. Still to verify while building:

- Organization-owned API keys in Better Auth's API key plugin (doc 01).
- Mistral OCR's block coordinates (read as pixels of the page's dimensions) against a real response (doc 07).
