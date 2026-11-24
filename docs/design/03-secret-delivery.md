# 03. Secret delivery to deployed Workers (build step 2)

Scope: build step 2. Agents never read organization secrets. Values reach only the agent's deployed code (one Workers for Platforms script per deployment) when it is dispatched for a tool or hook, and never the model's context, the case thread, logs or run capture. MCP OAuth tokens are held the same way. Which secrets an agent's code receives is a guardrail.

## Decision

- **Organization secrets are `secret_text` bindings on the deployment's Workers for Platforms script**, set at upload from our encrypted store and re-synced when a value or a grant changes. the original suggestion, confirmed.
- **MCP OAuth tokens are not bound.** Customer code reaches MCP servers through an `MCP` capability the runtime passes with each dispatch, as a dynamic dispatch prop (Cloudflare's documented pattern for request-scoped platform capabilities). The capability is an RPC stub of the runtime's `McpBroker` entrypoint, whose own props (the organization, agent and deployment) customer code can neither read nor change. It forwards to the API Worker's token service, which attaches the organization's token, refreshes it, and enforces the MCP-server guardrail. Customer code never holds the token. Every connection belongs to the organization; there are no personal connections.
- **The runtime Worker (Pi Durable) has no Secrets Store binding.** Plaintext exists only in the deploy and sync jobs (memory, briefly) and inside the customer's script.
- **The SDK redacts bound secret values** from tool results, hook results, errors and logs before they leave the customer's Worker, so a careless `return { headers }` does not put a key into the model's context, the thread, logs or capture. The docs describe this as defense in depth, not a guarantee: customer code that transforms a value can still leak it.

## Which secrets a script receives

```ts
// Agent code declares what it needs
export default agent({
  secrets: ["STRIPE_KEY", "ERP_TOKEN"],
  tools: { charge: tool({ sideEffects: true, run: async (input, { env }) => stripe(env.STRIPE_KEY)… }) },
});
```

```ts
// The guardrail: which agents' code may receive each secret
export const secretGrants = pgTable("secret_grants", {
  organizationId: text().notNull(),
  secretId: text().notNull().references(() => secrets.id, { onDelete: "restrict" }),
  agentId: text().notNull().references(() => agents.id, { onDelete: "cascade" }),
  grantedBy: text().notNull(),
  grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.secretId, t.agentId] })]);

// What each live script actually holds, for status and audit
export const secretDeliveries = pgTable("secret_deliveries", {
  organizationId: text().notNull(),
  deploymentId: text().notNull(),
  secretId: text().notNull(),
  secretVersion: integer().notNull(),
  deliveredAt: timestamp({ withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.deploymentId, t.secretId] })]);
```

Bound set = declared ∩ granted. A deployment that declares a secret without a grant still builds, shows "waiting for: STRIPE_KEY", and cannot be promoted until an Admin or Owner approves the loosening; the approval writes the grant. The approval flow itself is step 5; step 2 only needs the comparison and the "waiting" status.

Reserved binding names (`MCP`, `MODELS`, `PREPROCESS_*`) cannot be secret names.

## Flows

**Deploy (upload).** The deploy Workflow (API side, has the KEK binding):
1. Reads the manifest, computes the bound set, records any waiting guardrail.
2. Decrypts those secrets in memory and uploads the script with `metadata.bindings` containing `{ type: "secret_text", name, text }` for each. Platform capabilities such as `MCP` are not upload bindings: the runtime passes them per dispatch (see MCP connections).
3. Writes `secret_deliveries` and one audit event per secret: `secret.delivered { secret, version, deployment }`.

Plaintext is never logged: the Workflow's evlog context carries only names and versions, and its step outputs (which Workflows persist) carry no values: decryption and upload happen in one step that returns only ids.

**Value change.** `PUT /v1/orgs/{org}/secrets/{name}` writes the new ciphertext and `version + 1`, audits `secret.updated`, and enqueues `secret.sync { secretId, version }` in the same transaction (outbox row, drained to a Queue). The consumer finds every **live script** whose deployment is bound to the secret and calls the WfP script secrets API on each, then updates `secret_deliveries` and audits `secret.delivered`. A script is live if its deployment is production, a current preview, or kept for rollback (step 2 decides how many).

- In-flight tool calls finish on the old value; new invocations get the new one once Cloudflare rolls the script's new version, which is immediate for WfP.
- The secrets page shows per secret "delivered to 4 of 4 deployments", from `secret_deliveries.secretVersion` versus `secrets.version`. A failed delivery retries with backoff and stays visible until it succeeds.
- There is no redeploy and no rebuild; the code is unchanged.

**Grant revoked** (tightening, no approval needed): the sync job removes the binding from every live script of that agent immediately. The deployment then shows the secret as declared but not granted, and tool calls that read it get `undefined`.

**Promote or roll back.** Rolling back is promoting an earlier deployment. Before it serves, the bound set is recomputed against **current** grants and values and the script resynced; an older deployment never brings back a revoked grant or an old value.

**Secret deleted.** Refused while any live deployment is bound to it; the error lists the deployments.

**Previews** receive the same values as production: the grant is per agent and applies to every deployment of it, and an organization has one set of secrets.

**Rotation of keys** (master or organization, doc 01) re-encrypts ciphertext only; plaintext does not change, so nothing is resynced.

## MCP connections

```ts
// In customer code, through the SDK
const crm = ctx.mcp("hubspot");                       // the agent's declared server
const result = await crm.call("search_contacts", { q });

// Runtime: each dispatch carries the capability as a prop
const MCP = ctx.exports.McpBroker({ props: { organizationId, agentId, deploymentId } });
env.DISPATCHER.get(script, { props: { MCP } }, { outbound });

// Runtime: the capability, forwarding to the API Worker's token service
class McpBroker extends WorkerEntrypoint<Env, { organizationId: string; agentId: string; deploymentId: string }> {
  call(server: string, tool: string, args: unknown) { return env.MCP_SERVICE.call(this.ctx.props, server, tool, args); }
}

// API Worker: the token service, bound only by the runtime
class McpService extends WorkerEntrypoint<Env> {
  async call(props, server: string, tool: string, args: unknown): Promise<unknown>;
  // 1. server is declared by the deployment and allowed by the MCP guardrail
  // 2. picks the organization's connection for that server (there are no personal connections)
  // 3. decrypts the token (same envelope scheme as secrets), refreshes it if expired, calls the server
  // 4. egress goes through the same network rules as the outbound Worker (open until step 5)
}
```

The runtime holds no Secrets Store binding, so the capability only carries identity; decryption stays in the API Worker. Locally, apps/namespace-local runs the script with the same props through Worker Loader.

```ts
export const mcpConnections = pgTable("mcp_connections", {
  id: text().primaryKey(),
  organizationId: text().notNull(),
  serverId: text().notNull(),
  keyVersion: integer().notNull(),
  ciphertext: bytea().notNull(),                    // { access_token, refresh_token, expires_at } encrypted with the org DEK
  status: text().notNull(),                         // "active" | "needs_reauth" | "revoked"
  updatedAt: timestamp({ withTimezone: true }).notNull(),
});
```

Why not bind tokens like secrets: access tokens expire within hours, so rebinding every refresh would push a new script version per token per refresh, and a refresh token in customer code could mint access long after the deployment is gone. MCP servers **bundled** with the agent run inside the customer's Worker and use ordinary secret bindings.

Tool results from the broker go back to customer code, which returns them to the runtime; the token never appears in either direction.

## Alternatives rejected

- **Inject values per dispatch** (runtime decrypts and sends secrets with each tool call). Puts plaintext and the master key in the Worker that runs the model loop and records capture; one logging mistake leaks it.
- **A secrets service binding the customer code calls at runtime** (`await env.SECRETS.get("X")`). Instant rotation, but every cold tool call depends on Postgres via Hyperdrive, it is a new API, and npm clients that read `env` would need wrapping. Rotation through the secrets API is fast enough.
- **Hold secrets in Cloudflare only** (no Postgres copy). They live encrypted in our Postgres; self-hosted installs need the same store; and we could not resync a new script without a source of truth.
- **Rebuild and redeploy on every change.** Turns a value change into a deployment with a new id, confusing promotion and rollback history, for no benefit over updating bindings.

## Settled decisions

- No personal MCP connections; every connection is the organization's, and the token service stays.
- Also settled: tokens are brokered rather than bound; deleting a secret a live deployment uses is refused; previews receive the same values; SDK redaction is documented as defense in depth.


## Still to verify (step 2 spike, not a question)

- That the WfP script secrets endpoint updates a dispatch-namespace script without re-uploading the bundle, and how fast new isolates see it.

## Open questions

None left in this doc.
