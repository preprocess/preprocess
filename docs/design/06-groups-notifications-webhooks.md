# 06. Group tagging, notifications and outbound webhooks (build step 3)

Scope: build step 3. Agents and their code know groups, never individual people. A case waits on a group; the agent tags groups in the thread; people reference groups, never people. Outbound webhooks report when a case completes, fails or needs a group, naming the group. Approval groups are step 4 and not designed here.

## Decision

- **Code and the agent only ever name groups**, by slug. There is no API, tool or payload that names a person on the agent's side.
- **A case waits on at most one group at a time**, set by agent code; it is the case index's `waiting_on_group_id` (doc 01).
- **Groups with access** to an agent are the groups with a grant on it (operator or viewer) and the Developers group. Those are the only groups code can wait on, tag or name as approvers; a group that approves must have operator access. There is no case-scoped access.
- **People do not tag people.** The thread is people talking with the agent; people reference groups (`@legal`), and a reference notifies the group like an agent's tag.
- **Notifications are the inbox plus email.** The inbox is computed on read from group membership and assignment. Tags and waits on a person's groups, and assignments to the person, are also emailed right away, unless that person turned it off.
- **Outbound webhooks** use the Standard Webhooks scheme (`webhook-id`, `webhook-timestamp`, `webhook-signature`, HMAC-SHA256), at-least-once, delivered through a Queue with retries and a delivery log.

## Tagging and waiting

```ts
// SDK, in agent code (hooks or success step)
ctx.waitOn("accounts-payable", { reason: "Vendor not found in ERP" });   // status → waiting
ctx.tag("legal", "I disagree with the change to payment terms: …");     // thread message mentioning a group

// Runtime tools the model sees
groups_list()  → [{ slug, name, description, access: "operator" | "viewer" | "developers" }]   // never members
tag_group({ group: slug, message: string })
```

- Group slugs named in code (`waitOn`, `tag`, approvals, and the manifest's `groups: [...]`) are checked at deploy. An unknown slug or a group without access to the agent **fails the deploy**. Approval groups must also have operator access.
- Because a deploy fails otherwise, a runtime tag or wait on a group without access can only happen with a computed slug; it fails with `group has no access to this agent`, returned to the agent as a tool error.
- While a live deployment names a group, that group and its grant on the agent cannot be removed (doc 01).
- People reference groups in the thread with the same syntax. There is no way to mention a person.

```ts
export const caseMentions = pgTable("case_mentions", {
  organizationId: text().notNull(),
  caseId: text().notNull(),                       // deleted with the case
  groupId: text().notNull().references(() => groups.id, { onDelete: "restrict" }),
  messageId: text().notNull(),                    // the thread message in the case DO
  by: text().notNull(),                           // "agent" | "person:<userId>"
  at: timestamp({ withTimezone: true }).notNull(),
}, (t) => [index().on(t.organizationId, t.groupId, t.at)]);

export const inboxReads = pgTable("inbox_reads", {
  organizationId: text().notNull(),
  userId: text().notNull(),
  itemKey: text().notNull(),                      // "mention:<id>" | "waiting:<caseId>:<since>"
  readAt: timestamp({ withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.itemKey] })]);
```

## Inbox (step 3 part)

The inbox for person U in organization O is cases waiting on U's groups, mentions of U's groups, and cases assigned to U:

```sql
-- cases waiting on U's groups
SELECT c.* FROM cases c
JOIN group_members gm ON gm.group_id = c.waiting_on_group_id AND gm.user_id = $u
WHERE c.organization_id = $o AND c.status = 'waiting'
UNION ALL
-- mentions of U's groups
SELECT … FROM case_mentions m JOIN group_members gm ON gm.group_id = m.group_id AND gm.user_id = $u …
UNION ALL
-- cases assigned to U (assignment by API or an Admin, doc 04)
SELECT c.* FROM cases c JOIN case_assignees a ON a.case_id = c.id AND a.user_id = $u
WHERE c.organization_id = $o AND c.status NOT IN ('completed', 'cancelled')
```

Every member of a tagged group sees it. Review items and approvals join this list in step 4. Fan-out on read means a person added to a group later sees that group's open items, and nothing needs rewriting when membership changes.

Live updates: the case DO already pushes thread events to open case rooms; the inbox polls on focus in step 3.

## Email for tags, waits and assignments

Tags and waits on a person's groups, and a case being assigned to the person, are emailed right away. One per-person switch turns all three off.

```ts
// Better Auth additionalFields on user: one switch per person, across organizations
user: { emailNotifications: boolean().notNull().default(true) }
```

- When a mention is written, a case enters `waiting`, or an assignment adds a person, the same transaction writes an outbox row; a Queue consumer resolves the group's members at send time, skips those with the switch off, and sends one email per person through Cloudflare Email Sending.
- For assignments the recipient is the assigned person, not a group. The Queue message id is `mention:<id>`, `waiting:<caseId>:<since>` or `assigned:<caseId>:<assignedAt>` plus the user id, and the consumer records sent keys in KV for a day, so a redelivery does not send twice.
- The email names the group (for tags and waits), agent, case title and the message (tags) or reason (waits), with a link to the case room. An assignment email says the case was assigned to the reader. A tag by a person names that person by display name ("Someone" without one); otherwise no email names other people.
- The switch is on the account settings page. Turning it off affects only email; the inbox is unchanged.

## Outbound webhooks

```ts
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: text().primaryKey(),                         // whk_…
  organizationId: text().notNull(),
  url: text().notNull(),                           // https only
  events: text().array().notNull(),                // subset of the three types below
  agentIds: text().array(),                        // null = all agents; optional filter (accepted proposal)
  keyVersion: integer().notNull(),
  signingSecret: bytea().notNull(),                // whsec_ value, envelope-encrypted like secrets (doc 01)
  enabled: boolean().notNull().default(true),
  createdBy: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: text().primaryKey(),                         // msg_…, also the webhook-id header
  organizationId: text().notNull(),
  endpointId: text().notNull(),
  eventType: text().notNull(),
  caseId: text().notNull(),
  payload: jsonb().notNull(),
  status: text().notNull(),                        // "pending" | "delivered" | "failed"
  attempts: integer().notNull().default(0),
  lastStatusCode: integer(),
  lastError: text(),
  nextAttemptAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
```

API:

```
GET|POST           /v1/orgs/{org}/webhooks                       create returns the signing secret once
GET|PATCH|DELETE   /v1/orgs/{org}/webhooks/{id}
POST               /v1/orgs/{org}/webhooks/{id}/rotate-secret    old secret valid 24 h; both signatures sent meanwhile
GET                /v1/orgs/{org}/webhooks/{id}/deliveries
POST               /v1/orgs/{org}/webhooks/{id}/deliveries/{msgId}/redeliver
```

### Payloads

```ts
type WebhookEvent =
  | { type: "case.completed"; data: { case: CaseRef; answers: Record<string, unknown> | null; answersUrl: string } }
  | { type: "case.failed";    data: { case: CaseRef; error: { code: string; message: string } } }
  | { type: "case.needs_group"; data: { case: CaseRef; group: { id: string; slug: string; name: string }; reason: string | null } };

type CaseRef = {
  id: string;
  agent: { id: string; slug: string };
  deployment: { id: string; environment: "production" | "preview" };
  status: "completed" | "failed" | "waiting";
  source: "api" | "app" | "mcp" | "schedule";
  idempotencyKey: string | null;                // lets the caller match the case it started
  url: string;                                  // case room
  statusUrl: string;                            // GET /v1/orgs/{org}/cases/{id}
};

type Envelope = { id: string; type: WebhookEvent["type"]; createdAt: string; organization: { id: string; slug: string }; data: WebhookEvent["data"] };
```

```http
POST https://customer.example/hooks/preprocess
content-type: application/json
webhook-id: msg_01JDX…
webhook-timestamp: 1764000000
webhook-signature: v1,base64(HMAC-SHA256(secret, "{id}.{timestamp}.{body}"))

{ "id": "msg_01JDX…", "type": "case.needs_group", "createdAt": "2026-11-24T10:00:00Z",
  "organization": { "id": "org_…", "slug": "acme" },
  "data": { "case": { … }, "group": { "id": "grp_…", "slug": "legal", "name": "Legal" }, "reason": "Payment terms exceed policy" } }
```

- `answers` is included when the serialised body is under 256 KB; otherwise `null` and the caller fetches `answersUrl`.
- `case.needs_group` fires every time a case enters `waiting` on a group, including a change from one group to another.
- No person is named anywhere in a payload.

### Delivery

1. The case index write that changes status (doc 04) inserts one `webhook_deliveries` row per matching endpoint in the same transaction, then sends the ids to the Queue `webhooks` after commit (same sweeper backstop as case start).
2. The consumer POSTs with a 10 s timeout. 2xx is delivered. Anything else retries with backoff (30 s, 2 m, 10 m, 30 m, 1 h, then every 3 h) for 24 hours, then `failed`.
3. An endpoint that has failed every delivery for 3 days is disabled, and Admins get an email through Cloudflare Email Sending.
6. Cases on preview deployments send webhooks too, with `deployment.environment` in the payload so receivers can ignore them. Cancellation sends nothing.
4. Egress from the platform refuses private, loopback and link-local addresses (no requests to internal hosts) and follows no redirects.
5. Order is not guaranteed; receivers order by `createdAt` and dedupe on `webhook-id`.

Endpoint changes and secret rotation are audit events (doc 02).

## Alternatives rejected

- **Per-person notification rows written at tag time.** Duplicates group membership and goes wrong when membership changes. Email resolves members at send time instead.
- **A hosted webhook service (Svix and similar).** Self-hosted installs need the same feature on Cloudflare only; the volume is small.
- **Our own signature scheme.** Standard Webhooks has verifiers in most languages; ours would need its own docs and libraries.
- **Workflows for delivery.** A Queue with a delivery table is enough and keeps retries visible in Postgres.

## Settled decisions

- A deploy fails if code names a group without access to the agent (to wait on, tag or approve); groups and grants in use cannot be removed; no case-scoped access.
- Approving groups must have operator access; viewers never approve.
- People don't tag people; they reference groups.
- Tags and waits are emailed right away, with a per-person switch to turn it off.
- Also settled: optional per-agent webhook filter; failing endpoints are disabled after 3 days with an email to Admins; preview cases send webhooks; cancellation sends none.
- A person's group reference notifies like an agent's tag, in the inbox and by email.
- Assignment is emailed right away, under the same per-person switch.


## Open questions

None left in this doc.
