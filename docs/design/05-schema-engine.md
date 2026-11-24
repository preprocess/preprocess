# 05. Schema engine (build step 3)

Scope: build step 3. The output schema can be deeply nested with very large option lists; fields can fetch and transform data and declare what a selection invalidates; the agent can read the whole schema at any time; large option lists are searched and paged through tools; `decide` picks one option or keeps the best few. Customer code runs only in the stateless Workers for Platforms script for the deployment.

## Decision

The original sketch is adopted and built like this:

- **The schema is SDK code.** A tree of groups, lists and fields. Each field's dynamic parts (visible, options, fetch, transform, review) are functions of the answers so far.
- **Those functions run in the customer's Worker**, never in the runtime. The runtime calls `POST /schema/evaluate` on the dispatched Worker with the answers and the fields to evaluate. This follows layout B: the runtime holds state, customer code is stateless.
- **Reading an answer records a dependency.** Each evaluation returns, per field, the paths it read. The runtime stores the dependency graph and needs no hand-written invalidation rules; `invalidates` declares only what reads cannot see.
- **Answers are stored flat** in the case Durable Object, keyed by path, each with a status `empty | agent | confirmed | stale` and who set it.
- **Fetched data is saved with the case**, keyed by field and the values of what the fetch read, and reused until those change.
- **The agent can read everything at any time** through runtime tools: an overview first, then full reads of any part, answers in any order, and search and paging for large option lists. `decide` runs over the full list on the platform side.

## Expressing a schema (SDK)

```ts
import { schema as s } from "@preprocess/sdk";

export const output = s.group({
  vendor: s.select({
    description: "Vendor that issued the invoice",
    options: s.source({                                            // large list: searched and paged, never loaded whole
      search: async (q, { cursor, env }) => erp(env.ERP_TOKEN).vendors.search(q, cursor),
      get: async (ids, { env }) => erp(env.ERP_TOKEN).vendors.get(ids),
    }),
    review: "required",
  }),
  vendorRecord: s.fetched({                                        // fetch and transform
    fetch: async (a, { env }) => erp(env.ERP_TOKEN).vendors.get([a.get("vendor")]),
    transform: (rows) => ({ terms: rows[0].paymentTerms, currency: rows[0].currency }),
  }),
  currency: s.select({
    options: (a) => a.fetched("vendorRecord").currency ? [a.fetched("vendorRecord").currency] : CURRENCIES,
  }),
  lines: s.list(s.group({
    sku: s.text(),
    glAccount: s.select({
      visible: (a) => a.get("vendor") !== null,
      options: (a) => glAccountsFor(a.get("vendor")),            // ordinary code, no filter primitive
      invalidates: [],
    }),
    amount: s.number(),
  })),
  approverNote: s.text({ visible: (a) => a.sum("lines[*].amount") > 10_000, review: "required" }),
}, {
  checks: {
    totalsMatch: (a) => a.sum("lines[*].amount") === a.get("total") || { field: "total", message: "Lines do not add up" },
  },
});
```

- Field kinds in step 3: `text`, `number`, `boolean`, `date`, `select` (one), `multiselect`, `group`, `list`, `fetched`. Each has a `description` the agent and reviewer see.
- `options` is an array (small lists) or `s.source({ search, get, page? })` for large ones. Options are `{ id: string; label: string; description?: string; data?: unknown }`.
- `review`: `"required" | "none"` or a function of answers; groups set it for their children.
- `invalidates: string[]`: paths a change to this field makes stale even though they never read it.
- Verification checks are functions over the current answers, evaluated in the same call, returning `true` or failures pinned to fields.
- Paths are dotted with list indices: `lines[2].glAccount`. Lists have stable item ids internally so reordering does not remap answers.

The SDK serialises the static tree (kinds, descriptions, which parts are dynamic) into the manifest at build time. Only the functions need the Worker.

## Customer-Worker contract

```ts
// POST /schema/evaluate  (runtime → customer Worker, through dispatch with org outbound rules)
type EvaluateRequest = {
  caseId: string;
  answers: Record<Path, unknown>;                       // current values, flat
  fetched: Record<Path, { key: string; data: unknown }>;// cached fetch results the runtime already holds
  targets: Path[] | "all";
};
type FieldEval = {
  visible: boolean;
  options?: { kind: "inline"; items: Option[] } | { kind: "source"; count?: number };
  review: "required" | "none";
  reads: Path[];                                        // every a.get / a.fetched path read while evaluating this field
  fetch?: { key: string; data: unknown };               // new fetch result when inputs changed; key = hash of read values
  value?: unknown;                                      // from transform, for fetched fields
  error?: string;
};
type EvaluateResponse = { fields: Record<Path, FieldEval>; checks: Array<{ name: string; ok: boolean; field?: Path; message?: string }> };

// POST /schema/options  (search and paging on a source)
type OptionsRequest = { caseId: string; path: Path; answers: Record<Path, unknown>; query?: string; cursor?: string; ids?: string[]; limit: number };
type OptionsResponse = { items: Option[]; cursor?: string; total?: number };
```

The SDK's `a` accessor records reads; customer code cannot forget to declare a dependency.

## State in the case Durable Object (SQLite)

```sql
CREATE TABLE answers (
  path TEXT PRIMARY KEY,
  value TEXT,                    -- JSON
  status TEXT NOT NULL,          -- 'empty' | 'agent' | 'confirmed' | 'stale'
  set_by TEXT,                   -- 'agent' | 'person:<userId>'
  set_at INTEGER,
  stale_because TEXT,            -- JSON: [{ path, from, to }] the changes that made it stale
  suggested_value TEXT,          -- JSON: the agent's suggestion beside a person's answer
  suggested_at INTEGER,
  version INTEGER NOT NULL       -- bumped on every write; the review tab sends it back (optimistic concurrency)
);
CREATE TABLE field_state (path TEXT PRIMARY KEY, visible INTEGER, hidden_because TEXT, options_meta TEXT, review TEXT, evaluated_at INTEGER);
CREATE TABLE deps (path TEXT, reads TEXT, PRIMARY KEY (path, reads));   -- reverse index on reads
CREATE TABLE fetched (path TEXT PRIMARY KEY, key TEXT, data TEXT, fetched_at INTEGER);
CREATE TABLE checks (name TEXT PRIMARY KEY, ok INTEGER, field TEXT, message TEXT);
```

Fetched data is also written to run capture, so replays see the same data.

## Status and staleness rules

- `empty` → `agent` when the agent answers. `agent` → `confirmed` when a person confirms it; a person's edit sets `confirmed` directly (`set_by` shows it was entered, not just confirmed).
- **The agent never writes a `confirmed` field**, and a rerun never refills an answer a person entered, **even when it is stale**. When the agent answers such a field, the value is stored as `suggested_value` beside the person's answer; the Review tab shows it with an Accept button, and accepting it writes the value as `confirmed` by that person. The agent can also disagree in the thread.
- **When a value changes** (agent or person) at path P: every field F with P in its reads, plus every path in P's `invalidates`, is re-evaluated. If F has a value, it becomes `stale` with `stale_because`. A field with no value is simply re-evaluated.
- **Staleness does not cascade by itself.** A stale field's value has not changed, so its dependents are left alone until it is re-answered. This avoids one edit marking half the tree stale.
- A field that becomes hidden keeps its value and records `hidden_because` (the reads and their values: "hidden: vendor = null"). Hidden values are excluded from the output and from checks.
- A stale field the agent had set is refilled by a person by hand or by a rerun. A stale field a person had set is only ever changed by a person; the rerun leaves a suggestion beside it.
- A person's confirmed answer can go stale because of another person's edit; it is then handled like any stale person answer.
- A `fetched` field's transformed value has status `agent`; there is no fifth status.
- Hidden values stay in state but are excluded from the output, webhooks and checks.
- `review: "required"` does not block completion by itself; the SDK offers `allReviewed()` for agent code to use in its success condition.
- Every change by a person is a **review event** in Postgres; agent writes are in run capture.

```ts
export const reviewEvents = pgTable("review_events", {
  id: text().primaryKey(),
  organizationId: text().notNull(),
  caseId: text().notNull(),                         // deleted with the case
  userId: text().notNull(),
  kind: text().notNull(),                           // "field.edited" | "field.confirmed" | "suggestion.accepted" | "rerun" | "completed" | … (approvals, memory: steps 4 and 8)
  path: text(),
  before: jsonb(), after: jsonb(),
  checks: jsonb(),                                  // check results after the action
  at: timestamp({ withTimezone: true }).notNull(),
});
```

## Agent tools (built into the runtime)

| Tool | Returns |
|---|---|
| `schema_overview()` | The whole tree in compact lines: path, kind, status, visible or why hidden, stale and why, value summary (truncated), option count, review requirement, failing checks. Called automatically at run start and placed in context |
| `schema_read({ paths })` | Full detail for the given paths or subtrees: description, kind, conditions (what visibility and options read, with current values), value, status, reasons, fetched data, inline options |
| `schema_answer({ answers: [{ path, value }] })` | Writes agent answers; per path `ok`, `suggested` (the field holds a person's answer, so the value is stored as a suggestion) or a refusal (hidden, not an option); then what became stale, visible or hidden as a result |
| `options_search({ path, query, cursor? })` | One page of matching options (default 20) with `total` when the source knows it |
| `options_page({ path, cursor? })` | The next page in source order |
| `decide({ path, prompt, keep? })` | Groundhog-1 over the field's full option list on the platform side, through `/v1/systemone` (doc 07); returns one pick or the best `keep`. The list never enters the agent's context. In steps 1–6 it runs against the stub model service |

Overview size: one line per field. Lists longer than 20 items are summarised (`lines[0..199]: 180 agent, 12 empty, 8 stale`) with the non-trivial items (stale, empty and required, failing checks) still listed. `schema_read` on the list gives everything. The overview is regenerated, not appended, after each answer batch, so it stays one summary in context.

## Review tab and reruns

- The Review tab reads the same state from the DO and edits through `PATCH …/answers` with `{ path, value, version }`. A version mismatch returns 409 so two people (or a person and the agent) never silently overwrite each other.
- A reviewer's option search calls `POST /schema/options` without the agent's narrowing.
- Rerun re-evaluates `all`, regenerates the overview with `stale_because` and the review events since the last run, and resumes the agent.

## Alternatives rejected

- **JSON Schema with a condition language (JSONLogic and similar).** There is no filter primitive by design; option functions are ordinary code. A condition language would be one.
- **Evaluating field functions in the runtime DO.** Customer code does not run there (layout B), and fetches need the customer's secrets and network rules.
- **Hand-declared dependency graphs.** The sketch wants invalidation without hand-written rules; recorded reads give it.
- **Cascading staleness transitively.** Marks fields stale whose inputs have not changed.
- **Progressive reveal** (show the agent only the next fields). Ruled out: the agent can read everything at any time.
- **Loading large option lists into context.** Large lists are searched and paged through tools instead.

## Settled decisions

- A rerun never refills an answer a person entered, even a stale one; the agent suggests a value beside it. Designed above.
- Also settled: transformed values have status `agent`; hidden values are excluded from output, webhooks and checks; `allReviewed()` instead of implicit blocking; another person's edit can make a confirmed answer stale.
- Answers a person only confirmed get suggestions too, never overwrites.


## Open questions

None left in this doc.
