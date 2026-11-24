# 09. Logs, then evals from completed cases (build step 6)

Scope: build step 6 (PRE-36), spec sections 11 and 12, the **Evals** and **Logs and capture** parts of mvp-surface. Engineering accepted the product answers on 2026-11-24 (PRE-36). Chip may still overrule three of them: how a case is scored, what a result does, and the completed-without-a-person metric.

## Decision

**Logs**

- **Our code logs with evlog**: one wide event per API request (`evlog/hono`), per case run, model call, tool call, summary and platform job, with structured errors. Run capture stays the full record of a case. Logs are what people search, read across cases and export.
- **The customer's Worker output is logged too.** A Tail Worker (`apps/tail`) is attached to every Dynamic Worker the runtime loads, through the Worker Loader's `tails`. It turns console output and uncaught exceptions into log records with `source: "agent"`, scoped by the `x-preprocess-org`, `-agent`, `-deployment` and `-case` headers the runtime sets on every call. The SDK masks bound secret values in `console.*` before they reach the tail, the same way it already masks them in tool output.
- **One ingestion path.** Every producer's records reach the `LOGS` Queue: the API sends them itself, and the runtime and the Tail Worker through the API's `Platform` entrypoint. Its consumer, in the API Worker, does three things per batch: writes the records to the log store, updates the summaries in Postgres, and forwards them to the organization's OpenTelemetry endpoint when export is on. Errors also go to PostHog when `POSTHOG_KEY` is set (our cloud only).
- **The log store is R2.** In staging and production the consumer sends to a Pipelines stream whose sink writes an Iceberg table (`logs.run_logs`, partitioned by day) in the R2 Data Catalog, and the API queries it with R2 SQL. Pipelines and R2 SQL have no local runtime, so local development and tests use a second implementation of the same `LogStore` interface. It writes NDJSON objects to the `LOGS` bucket under `{org}/{day}/{agent}/{case or "_"}/{id}.ndjson` and filters within the Worker. `LOG_STORE=sql|r2` picks the implementation.
- **Postgres keeps only summaries**: one row per case and one per deployment (`log_summaries`), with counts of events, errors and warnings, the last error, and the first and last timestamps.
- **OpenTelemetry export** is an organization setting (Admin or Owner): an OTLP/HTTP endpoint, headers stored write-only and envelope-encrypted like secrets, and a switch. It sends logs to `/v1/logs` and traces to `/v1/traces`. There's one trace per case (the trace id is derived from the case id), with a span per model call and tool call. Export is free. A failed export is retried by the queue and then dropped, with a warning in the organization's own logs. Changing the setting is audited. Metrics are not exported.
- **Who sees logs.** Anyone with access to an agent sees a case's logs in the case room's Run tab. The agent's Logs page, across cases and deployments, is for Developers and Admins.

**Evals**

- **The automatic suite.** Each agent has one, created with its first completed case. Every case that reaches `completed` joins it, and the suite keeps the newest 100 (`cap`, 1–1000, default 100, set by Developers and Admins). Failed, cancelled and halted cases never join. Manual suites take any number of selected completed cases and have no cap.
- **What a suite case holds.** Taken when the case joins: the case input (text and file references), the final human-corrected answers as the expected result, the agent's original answers beside them, and the run capture key. Deleting a case removes it from every suite from then on (spec 19).
- **A run replays each suite case** against one deployment and one model. Each case becomes an eval case: a case Durable Object in eval mode, keyed `eval:{run}:{case}`, that never appears in the inbox, sends no webhooks and emails nobody. A run across models is one run per model, compared side by side.
- **Side effects are never repeated.** A tool declared with `sideEffects` isn't dispatched in eval mode. It returns the result recorded in the original capture for the same tool name and input, and otherwise an error result saying it isn't available in evals. Tools without side effects run for real. A wait on a group or an approval ends the eval case as `needed_person`.
- **Scoring is field by field** through one `Scorer` interface, so a model judge can be added later without changing runs or storage. The MVP scorer: strings and enums ignore case and surrounding or repeated whitespace, numbers and booleans match exactly, arrays and objects match deeply with the same rules. A case passes when every expected field matches. A run reports the pass rate, each field's match rate and the number of `needed_person` cases.
- **Results are informational.** They appear on the deployment page, in `preprocess evals run` and in deploy output. Promotion warns, without blocking, when a suite's latest pass rate on the deployment being promoted is lower than on the current production deployment.
- **On push.** When the agent's effective `evals.onPush` is true (from #22, off by default, overridable like any default), every deployment that becomes `ready`, preview or production, runs each suite marked `runOnPush`. A deployment waiting on a guardrail runs them once it's approved.
- **Cost.** Eval cases are metered and pass the spend gate like cases. Each run records its cost, the spend gate sums cases and eval runs, and usage shows eval spend on its own line.
- **Completed without a person.** Among the agent's production cases that completed, the share with no review event by a person, no message from a person in the thread and no wait on a group. `cases.person_involved` is set by the API when any of the three happens. It shows on the agent overview and on each deployment.

## Shapes

```ts
// One run-log record: the Pipelines stream schema, the NDJSON line, and what the API returns.
type LogRecord = {
  id: string; // ULID
  at: string; // ISO time
  organizationId: string;
  agentId: string | null;
  deploymentId: string | null;
  caseId: string | null;
  source: "platform" | "agent";
  level: "debug" | "info" | "warn" | "error";
  kind: string; // "request", "case.run", "model.call", "tool.call", "console", "exception", …
  message: string;
  durationMs: number | null;
  traceId: string | null;
  spanId: string | null;
  error: { message: string; why?: string; fix?: string; status?: number } | null;
  data: string; // JSON of the wide event's remaining fields, secrets redacted
};

interface LogStore {
  write(records: LogRecord[]): Promise<void>;
  query(q: {
    organizationId: string; // always from the credential, never the query string
    agentId?: string; deploymentId?: string; caseId?: string;
    level?: LogRecord["level"]; search?: string; from?: string; to?: string;
    cursor?: string; limit: number;
  }): Promise<{ records: LogRecord[]; cursor: string | null }>;
}

interface Scorer {
  score(field: SchemaField, expected: unknown, actual: unknown): { match: boolean; score: number };
}
```

```sql
-- Tenant tables: ENABLE + FORCE RLS, the tenant policy, grants, FKs on (organization_id, id).
log_summaries (organization_id, subject_kind 'case'|'deployment', subject_id, events, errors, warnings,
               last_error jsonb, first_at, last_at, PRIMARY KEY (organization_id, subject_kind, subject_id))
otel_exports (organization_id PK, endpoint, headers_ciphertext, enabled, updated_by, updated_at)
eval_suites (id, organization_id, agent_id, name, kind 'automatic'|'manual', cap int NULL,
             run_on_push bool, created_by, created_at)      -- one automatic suite per agent (partial unique)
eval_suite_cases (suite_id, case_id, organization_id, input jsonb, expected jsonb, original jsonb,
                  capture_key, added_at, PRIMARY KEY (suite_id, case_id))
eval_runs (id, organization_id, suite_id, deployment_id, model, trigger 'manual'|'push',
           status 'queued'|'running'|'completed'|'failed', cases, passed, needed_person, failed,
           cost_micro_usd, created_by, created_at, finished_at)
eval_results (run_id, case_id, organization_id, status 'passed'|'failed'|'needed_person'|'error',
              fields jsonb, answers jsonb, capture_key, cost_micro_usd, PRIMARY KEY (run_id, case_id))
cases.person_involved bool NOT NULL DEFAULT false
```

## API, CLI and pages

- `GET /v1/orgs/{org}/logs` (filters: agent, deployment, case, level, search, from, to, cursor) and `GET …/cases/{case}/logs`. `GET|PUT|DELETE …/settings/otel`.
- `GET|POST …/agents/{agent}/eval-suites`, `GET|PATCH|DELETE …/eval-suites/{suite}`, `POST|DELETE …/eval-suites/{suite}/cases`, `POST …/eval-suites/{suite}/runs` (deployment, models[]), `GET …/eval-runs/{run}` with results. Promotion's response gains `warnings`.
- CLI: `preprocess logs [--case|--deployment] [--level] [--search]`, `preprocess evals run <suite> [--deployment] [--model …]`, `preprocess evals list`. The MCP server picks the operations up from the OpenAPI schema.
- Pages (spec 14a): Agent → Operate → **Logs**, with a level segmented control with counts and a search field. Agent → Ship → **Evals**: suites, then a suite page and a run page with breadcrumbs, plus a comparison across models. The case room's Run tab gains the case's logs. The deployment page gains eval results. Organization settings gain **OpenTelemetry export**.

## Pull requests

1. This doc.
2. Logs: evlog in the API and runtime, the Tail Worker and SDK console masking, the queue and consumer, both `LogStore`s, summaries, the logs API and CLI, and the Alchemy stream, sink, catalog table and queue.
3. Logs UI and OpenTelemetry export.
4. Evals: tables, the automatic suite, eval mode in the runtime with side-effect replay, the runner and scorer, the API and CLI, and spend.
5. Evals UI, on-push runs, the promotion warning and the completed-without-a-person metric.

## Rejected

- **Writing logs straight to Pipelines from each Worker.** It would skip Postgres summaries and OTel export, or need them done three times. The queue gives one consumer with database access, batching and retries.
- **Logs in Postgres.** The spec keeps only summaries there.
- **An LLM judge now.** No hosted models exist yet, and it would be a new feature. The `Scorer` interface leaves room for one.
- **Re-running side-effect tools against a sandbox copy.** We don't own the customer's systems, so there's no copy to run against. Replaying from capture is exact for the original path and fails loudly when the path diverges.

## To verify while building

- Whether R2 SQL's query latency suits the case room's Run tab. If it doesn't, the case's logs can be read from the R2 objects the sink writes for that day.
- That a Tail Worker attaches to Workers for Platforms user scripts through the upload's `tail_consumers`, both locally and on Cloudflare.
