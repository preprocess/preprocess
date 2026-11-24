# 03. Secret delivery to agent code (build step 2)

Scope: build step 2. Agents never read organization secrets. Values reach only the agent's own code, which runs as a Dynamic Worker the runtime loads from the deployment's bundle, and never the model's context, the case thread, logs or run capture. MCP OAuth tokens are held the same way. Which secrets an agent's code receives is a guardrail.

## Decision

- **Agent code runs as Dynamic Workers** (Worker Loader), not Workers for Platforms. Deploying stores the bundle in the runtime's `BUNDLES` R2 bucket and records its SHA-256 on the deployment; nothing is uploaded to Cloudflare per deployment. The PRE-45 spike measured 2–5 ms per warm call from a Worker and under 1 ms from a Durable Object, against 15–52 ms through a dispatch namespace.
- **Secrets enter the isolate's `env` when it loads, and the isolate id carries a secrets version.** Each isolate is named `<org>:<agent>:<deployment>:<secrets version>:<rules>`. The runtime asks the API for the deployment's secrets version on every call; any change to a bound value or grant moves the version, so the next call names a different isolate and loads it with the current values. Values are decrypted only inside the loader callback, when a new isolate is created, and go straight into its `env`. SDK bundles keep reading `env.STRIPE_KEY` exactly as before.
- **MCP OAuth tokens are not delivered.** Customer code reaches MCP servers through an `MCP` capability the runtime passes with each call as an entrypoint prop. The capability is an RPC stub of the runtime's `McpBroker` entrypoint, whose own props (the organization, agent and deployment) customer code can neither read nor change. It forwards to the API Worker's token service, which attaches the organization's token, refreshes it, and enforces the MCP-server guardrail on every call. Customer code never holds the token. Every connection belongs to the organization; there are no personal connections.
- **The runtime Worker (Pi Durable) holds no key.** Decryption happens in the API Worker's `Platform` entrypoint; the runtime passes the plaintext from that RPC into the loader and keeps no copy.
- **The SDK redacts bound secret values** from tool results, hook results, errors and logs before they leave the agent's code, so a careless `return { headers }` does not put a key into the model's context, the thread, logs or capture. The docs describe this as defense in depth, not a guarantee: customer code that transforms a value can still leak it.

### Why a version in the id, not secrets per call

Both satisfy "a rotation or revoke takes effect on the next call". Passing secrets per call would decrypt every bound value on every tool call and put plaintext into each call's props, where the runtime handles it constantly. A version in the id costs one small query per call (the version is a hash of `secretId:version` pairs, the first 8 bytes of a SHA-256, or `none`), decrypts only when an isolate loads, and keeps the SDK's `env` contract unchanged. If a value changes between the version check and the loader reading the values, the loader sees a different version, refuses to build that isolate, and the call retries once under the new version, so an id never holds values other than the version it names.

## Which secrets a deployment receives

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
```

Bound set = declared ∩ granted, computed from current grants and values each time it is asked. A deployment that declares a secret without a grant still builds, shows "waiting for: STRIPE_KEY", and cannot be promoted until an Admin or Owner approves the loosening; the approval writes the grant.

There is no delivery table: nothing is pushed anywhere, so what a deployment receives is always what the bound set says now. Each isolate load audits one `secret.delivered { secret, version, deployment }` per value, with the platform runtime as actor.

Reserved binding names (`MCP`, `MODELS`, `PREPROCESS_*`) cannot be secret names.

## Flows

**Deploy.** The API stores the bundle through the runtime (`putBundle`), which writes it to `BUNDLES` at `<org>/<agent>/<deployment>.json` and returns its SHA-256; the deployment row records it as `bundle_sha256`. The runtime then loads the bundle to read its manifest, and the API computes the bound set and any waiting guardrail.

**Value change.** `PUT /v1/orgs/{org}/secrets/{name}` writes the new ciphertext and `version + 1` and audits `secret.updated`. Nothing else happens: the next call to any deployment bound to the secret sees a new secrets version and loads a fresh isolate. In-flight calls finish on the old isolate. There is no redeploy, no rebuild and no sync job.

**Grant revoked** (tightening, no approval needed): the same. The bound set shrinks, the version moves, and the next call's isolate has no such `env` entry, so code that reads it gets `undefined`. The live deployments recheck what they wait for inside the revoking transaction.

**Promote or roll back.** Rolling back is promoting an earlier deployment. Its bound set comes from current grants and values like any other call, so an older deployment never brings back a revoked grant or an old value. Neither touches Cloudflare.

**Secret deleted.** Refused while any live deployment is bound to it; the error lists the deployments.

**Previews** receive the same values as production: the grant is per agent and applies to every deployment of it, and an organization has one set of secrets.

**Rotation of keys** (master or organization, doc 01) re-encrypts ciphertext only; plaintext and secret versions do not change, so no isolate reloads.

## Loading agent code

- **Bundle integrity.** Every read of a bundle is checked against the deployment's recorded SHA-256, whichever tier it came from. A mismatch in a cache tier is discarded and the next tier tried; a mismatch from R2 fails the call with "the bundle of deployment X does not match its hash".
- **Bundle cache.** Three tiers: a per-isolate map (32 MB, least recently used out first), Cloudflare's colo cache keyed by the bundle key and hash, then R2. The spike measured about 120 ms of a 155 ms cold load in the R2 read, so a reload for a new secrets version or an evicted Dynamic Worker usually skips it.
- **In-flight guard.** Cloudflare allows 10 distinct Dynamic Workers in flight per Durable Object and 4 per Worker request, and throws ("Dynamic worker concurrency limit exceeded") rather than queuing. The runtime counts its own calls per context and makes calls past the limit wait for a slot; calls to an isolate already in flight count once.
- **CPU.** Custom Dynamic Worker `limits` did not take effect in the spike, so nothing relies on them. The case's `timeoutSeconds` stays the real bound on how long agent code can run.
- **Egress.** The isolate's `globalOutbound` is the runtime's `Outbound` entrypoint, with the organization and its network rules as props; a blocked host gets a 403 `blocked_by_network_rules`. The rules are part of the isolate id, so a change applies on the next call.
- **Logs.** The Tail Worker (`apps/tail`, doc 09) is attached through the loader's `tails`.

Worker Loader runs in Cloudflare's local runtime, so development and tests load agent code the same way a deployed stage does. Locally the concurrency limit is not enforced, which is why the runtime's guard exists in code.

## MCP connections

```ts
// In customer code, through the SDK
const crm = ctx.mcp("hubspot");                       // the agent's declared server
const result = await crm.call("search_contacts", { q });

// Runtime: each call carries the capability as a prop
const MCP = ctx.exports.McpBroker({ props: { organizationId, agentId, deploymentId } });
env.LOADER.get(id, load).getEntrypoint(undefined, { props: { MCP } }).fetch(…);

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
}
```

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

Why not put tokens in `env` like secrets: access tokens expire within hours, so each refresh would move the secrets version and reload every isolate, and a refresh token in customer code could mint access long after the deployment is gone. MCP servers **bundled** with the agent run inside the agent's code and use ordinary secrets.

Tool results from the broker go back to customer code, which returns them to the runtime; the token never appears in either direction.

## Alternatives rejected

- **Workers for Platforms with `secret_text` bindings**, the step 2 design until PRE-45. It needed a sync job per value or grant change (`secret.sync`, `secret_deliveries`), a script upload per deployment, and a dispatch namespace per stage, and its calls were an order of magnitude slower.
- **Secrets passed per call.** Rotation is equally immediate, but every tool call decrypts every value and carries plaintext in its props.
- **A secrets service the customer code calls at runtime** (`await env.SECRETS.get("X")`). A new API, and npm clients that read `env` would need wrapping.
- **Hold secrets in Cloudflare only** (no Postgres copy). They live encrypted in our Postgres; self-hosted installs need the same store.

## Settled decisions

- No personal MCP connections; every connection is the organization's, and the token service stays.
- Tokens are brokered rather than delivered; deleting a secret a live deployment uses is refused; previews receive the same values; SDK redaction is documented as defense in depth.
- Dynamic Worker `limits` are not relied on for CPU; `timeoutSeconds` is.

## Open questions

- Dynamic Workers have been in open beta since 24 March 2026, with no GA date found. Revisit the concurrency limits and `limits` support when it reaches GA.
