# 02. Audit chain (build step 1)

Scope: build step 1. Every action by a person, an agent, an API key or the platform is recorded in an append-only log that is hash-chained per organization, copied daily to retention-locked storage, kept at least one year, and not removed when a case is deleted. Listing and verifying are free; export is a paid feature.

## Decision

The audit log is built on seven decisions:

1. Append-only table in Postgres, no update or delete path, enforced by grants **and** a trigger.
2. Hash-chained per organization, with a gap-free per-organization sequence serialised by a head row.
3. Written in the same transaction as the action it records, so an action without its audit event cannot commit.
4. A daily signed batch per organization to an R2 bucket with a bucket lock, written even on days with no events, so truncation of the tail is detectable.
5. Signed with one Ed25519 key per install (our cloud has one, each self-hosted install generates its own), not per organization.
6. Kept separately from run logs; at least one year (the R2 lock is one year for every organization); the case id is a plain column, not a foreign key, so deleting a case never touches audit rows.
7. Audit rows hold ids, field paths and names, never answer values, file contents or secret values.

## Table

```ts
export const auditActor = pgEnum("audit_actor", ["person", "agent", "api_key", "platform"]);

export const auditEvents = pgTable("audit_events", {
  organizationId: text().notNull(),
  seq: bigint({ mode: "number" }).notNull(),             // 1, 2, 3… per organization, no gaps
  id: text().notNull().unique(),                         // aud_…
  occurredAt: timestamp({ withTimezone: true, precision: 6 }).notNull(),
  actorType: auditActor().notNull(),
  actorId: text().notNull(),                             // user id, agent+deployment id, api key id, or "platform:<job>"
  onBehalfOf: text(),                                    // e.g. the person whose MCP connection a tool call used
  action: text().notNull(),                              // "group.member.added", "secret.updated", "deployment.promoted"…
  targetType: text(),
  targetId: text(),
  caseId: text(),                                        // no FK, survives case deletion
  requestId: text(),                                     // joins to evlog wide events
  ip: inet(),
  data: jsonb().notNull().default({}),                   // ids, names, paths; never values (see Rules)
  prevHash: bytea().notNull(),                           // 32 bytes
  hash: bytea().notNull(),                               // 32 bytes
}, (t) => [primaryKey({ columns: [t.organizationId, t.seq] }), index().on(t.organizationId, t.occurredAt), index().on(t.organizationId, t.caseId)]);

export const auditHeads = pgTable("audit_heads", {
  organizationId: text().primaryKey(),
  seq: bigint({ mode: "number" }).notNull(),
  hash: bytea().notNull(),
});
```

```sql
REVOKE ALL ON audit_events FROM preprocess_app, preprocess_system;
GRANT SELECT, INSERT ON audit_events TO preprocess_app, preprocess_system;
GRANT SELECT, UPDATE ON audit_heads TO preprocess_app, preprocess_system;

CREATE FUNCTION audit_events_immutable() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'audit_events is append-only'; END $$;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_immutable();
```

The trigger protects against the migrator role and mistakes (its one exception, purging a deleted organization's year-old rows, is under Deleted organizations); the table owner can still drop it, which is why the R2 copy exists.

## Appending

```ts
// packages/db/src/audit.ts — the only writer
export async function audit(tx: Tx, e: AuditInput): Promise<void> {
  const head = await tx.select().from(auditHeads)
    .where(eq(auditHeads.organizationId, e.organizationId)).for("update");      // serialises appends per org
  const seq = head.seq + 1;
  const body = canonical({ organizationId, seq, id, occurredAt, actorType, actorId, onBehalfOf,
                           action, targetType, targetId, caseId, requestId, ip, data });
  const hash = sha256(concat(head.hash, body));                                 // hash_n = SHA-256(hash_{n-1} || JCS(event_n))
  await tx.insert(auditEvents).values({ ...e, seq, prevHash: head.hash, hash });
  await tx.update(auditHeads).set({ seq, hash }).where(eq(auditHeads.organizationId, e.organizationId));
}
```

- `canonical` is RFC 8785 JSON Canonicalization (timestamps as RFC 3339 with microseconds), so a verifier in any language recomputes the same bytes.
- Creating an organization inserts its head (`seq = 0`, `hash = 32 zero bytes`) and the first event, `organization.created`, in the same transaction.
- The `FOR UPDATE` lock lasts only for the action's transaction. Audit volume per organization is low (people's actions, deploys, side-effecting tool calls), so contention is not a concern; if it ever is, the fix is shorter transactions, not a different chain.

**Events that do not originate in a Postgres transaction** (the case Durable Object: tool calls with side effects, `decide`, agent tags) call an internal `POST /internal/audit` on the API Worker over a service binding, which runs `audit()` in its own transaction. For a tool call with side effects the runtime records `tool.call.started` **before** dispatching it and `tool.call.finished` (ok or error) after, so a crash between the two still leaves a record that the call was attempted. If the start event cannot be written, the tool call does not run.

What gets recorded: sign-ins, access and group changes, settings and guardrails, secret writes and which deployment received a secret, deploys and promotions, case actions, approvals, tool calls with side effects, and exports. Agent and person tags of groups are audit events (`case.group.tagged`); `decide` choices are not (they are in run capture). Which tool calls have side effects is declared by the tool in agent code (SDK `sideEffects: true`); tools that only read are captured in the run, not audited.

## Daily signed copy

A Cron Trigger at 00:20 UTC starts one Workflow instance per organization with events the previous UTC day, plus every live organization whose last anchor is older than a day (the empty-day anchor). Deleted organizations get no further anchors after their final manifest.

For organization `o` and day `d` the Workflow writes, to the bucket `audit` (its own bucket, not the run-log bucket):

```
audit/{o}/{yyyy}/{mm}/{dd}/events.ndjson      // canonical events of day d, ascending seq, with seq, prevHash, hash in hex
audit/{o}/{yyyy}/{mm}/{dd}/manifest.json
```

```ts
type AuditManifest = {
  v: 1;
  organizationId: string;
  day: string;                    // "2026-11-23"
  firstSeq: number | null;        // null on an empty day
  lastSeq: number;                // head seq at the end of the day
  count: number;
  prevHash: string;               // hash before firstSeq (equals headHash on an empty day)
  headHash: string;               // hash at lastSeq
  eventsSha256: string | null;
  signedAt: string;
  keyId: string;                  // "audit-ed25519-2026-11"
  signature: string;              // Ed25519 over the JCS bytes of this object without "signature"
};
```

- The bucket has an R2 bucket lock rule on the `audit/` prefix with one year of retention for every organization, declared in the Alchemy stack. Objects of live organizations are not deleted when the lock lapses; there is no lifecycle rule, because retention policies are deferred to a later version. Only a deleted organization's objects are removed, by the purge job above.
- The signing key is Ed25519 in Secrets Store (`audit-signing-<keyId>`), bound only to the audit Workflow. Public keys are served at `GET /v1/audit/keys` and listed in the docs. Self-hosted installs generate their own key at install.
- The Workflow is idempotent per `(o, d)`: if the manifest exists it verifies it and stops. Under a bucket lock a second write would fail anyway.

## API (free)

```
GET  /v1/orgs/{org}/audit-events?after=<seq>&limit=&action=&actor=&caseId=&from=&to=
GET  /v1/orgs/{org}/audit-events/{id}
POST /v1/orgs/{org}/audit-events/verify   { from?: string, to?: string }
  → { ok: boolean, checkedThroughSeq: number, anchorsChecked: number,
      firstBreak?: { seq: number, reason: "hash_mismatch" | "gap" | "anchor_mismatch" | "anchor_missing" } }
GET  /v1/audit/keys
```

Verify walks the Postgres chain over the range and checks each day's manifest in R2 against the chain (head hash and last seq). The audit log is readable by Owners and Admins.

There is no audit streaming. Export (`POST /v1/orgs/{org}/audit-events/export`, NDJSON plus manifests) is the paid part, gated by `getPlan(org).assert("audit_export")`. That entitlement check lands with step 9; in step 1 the route exists behind the check, which fails closed on our cloud until billing is wired and on self-hosted installs without a key.

## Deleted organizations

Audit events outlive a deleted organization until their one-year lock ends, and are then deleted. This is the only delete path, and it is narrow:

```ts
export const deletedOrganizations = pgTable("deleted_organizations", {   // not RLS-scoped; written by the delete flow
  organizationId: text().primaryKey(),
  deletedAt: timestamp({ withTimezone: true }).notNull(),
  finalSeq: bigint({ mode: "number" }).notNull(),     // the chain's last seq, which is the organization.deleted event
  finalHash: bytea().notNull(),
});
```

- Deleting an organization writes `organization.deleted` as the last event, copies the head into `deleted_organizations`, and writes a final manifest to R2 the same day. The `organization` row and its tenant data go; `audit_events`, `audit_heads` and the R2 objects stay.
- A daily purge job runs as a dedicated role, `preprocess_audit_purge`, which is the only role with `DELETE` on `audit_events`. The trigger is replaced by one that allows a delete only when the row's organization is in `deleted_organizations` **and** the row's `occurred_at` is more than one year ago. Everything else still raises.
- The same job deletes R2 objects for that organization once each object's lock has expired (an R2 delete before then fails anyway), and finally the `deleted_organizations` row when nothing is left.
- Live organizations keep everything: retention policies are deferred to a later version, so nothing of a live organization is ever purged.

```sql
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'preprocess_audit_purge'
     AND EXISTS (SELECT 1 FROM deleted_organizations d WHERE d.organization_id = OLD.organization_id)
     AND OLD.occurred_at < now() - interval '1 year' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only';
END $;
```

## Rules for `data`

- Never values: no answer values, no secret values, no file contents, no tool-call arguments or results. A field edit records `{ field: "invoice.total" }`; the before and after live in review events, which case deletion removes.
- Names that identify things are allowed: secret names, group slugs, agent slugs, the deployment that received a secret.
- People are recorded by user id. Email and name are resolved at read time.

## Alternatives rejected

- **A Durable Object per organization as the writer.** It serialises naturally, but cannot join the Postgres transaction of the action, so an action could commit without its event.
- **pgaudit or logical decoding.** Records SQL, not actors (person, agent, API key, platform) or intent, and does not reach the DO-side events.
- **R2 only.** Fine for retention, useless for listing and filtering in the app.
- **A Merkle tree or external transparency log.** Stronger, but a hash chain plus a locked copy is the requirement, and the daily anchor already detects rewriting.
- **A key per organization for signing.** More keys to rotate with no added assurance: the threat is us or an attacker rewriting Postgres, and a per-install key held outside Postgres covers it.

## Settled decisions

- Audit events outlive a deleted organization until their one-year lock ends, then are deleted. Designed above.
- The R2 lock is one year for everyone.
- No audit streaming; export is paid.
- Also settled: Owners and Admins read the audit log; group tags are audit events, `decide` choices are not.


## Open questions

None left in this doc.
