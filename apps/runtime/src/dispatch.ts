import type { Deployment, DeploymentRef, Env } from "./env.ts";
import type { OutboundProps } from "./outbound.ts";

// Agent code runs as a Dynamic Worker (design doc 03): the deployment's bundle
// from R2, loaded into its own isolate by the runtime's Worker Loader. Each
// call names the isolate by organization, agent, deployment, secrets version
// and network rules, so a rotated or revoked secret or changed rules load a
// fresh isolate on the next call and an isolate never outlives what it was
// given.

// The Durable Object's or the request's context: its exports supply the
// outbound gateway and the MCP capability.
type Context = {
  exports: unknown;
  storage?: unknown;
};

type Exports = {
  Outbound(options: { props: OutboundProps }): Fetcher;
  McpBroker(options: { props: DeploymentRef }): Fetcher;
};

export type Bundle = { mainModule: string; modules: Record<string, string> };

// Agent code runs with the platform's compatibility settings, not its own, so
// every deployment of every SDK version sees the same runtime.
export const AGENT_COMPATIBILITY = {
  date: "2026-07-26",
  flags: ["nodejs_compat"],
};

export const bundleKey = (d: DeploymentRef) =>
  `${d.organizationId}/${d.agentId}/${d.deploymentId}.json`;

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

const sha256 = async (text: string) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

// The deploy path stores each bundle once, under its deployment, and records
// the hash this returns.
export const storeBundle = async (
  env: Pick<Env, "BUNDLES">,
  d: DeploymentRef,
  bundle: Bundle,
) => {
  const text = JSON.stringify(bundle);
  await env.BUNDLES.put(bundleKey(d), text);
  return sha256(text);
};

// Bundles this isolate has read, newest last, so a reload (a new secrets
// version, an evicted Dynamic Worker) skips the R2 round trip. Cloudflare's
// cache holds them for the colo. Every read is checked against the hash the
// deployment recorded, whichever tier it came from.
const CACHE_BYTES = 32 * 1024 * 1024;
const cached = new Map<string, string>();
let cachedBytes = 0;

const remember = (key: string, text: string) => {
  const old = cached.get(key);
  if (old !== undefined) {
    cached.delete(key);
    cachedBytes -= old.length;
  }
  cached.set(key, text);
  cachedBytes += text.length;
  for (const [k, v] of cached) {
    if (cachedBytes <= CACHE_BYTES || k === key) break;
    cached.delete(k);
    cachedBytes -= v.length;
  }
};

const colo = () => (typeof caches === "undefined" ? null : caches.default);
const cacheUrl = (key: string, hash: string) =>
  `https://bundles.preprocess.internal/${key}?sha256=${hash}`;

export const loadBundle = async (
  env: Pick<Env, "BUNDLES">,
  d: Deployment,
): Promise<Bundle> => {
  const key = bundleKey(d);
  const url = cacheUrl(key, d.bundleHash);
  const tiers: Array<() => Promise<string | null>> = [
    () => Promise.resolve(cached.get(key) ?? null),
    async () =>
      (
        await colo()
          ?.match(url)
          .catch(() => undefined)
      )?.text() ?? null,
    async () => (await env.BUNDLES.get(key))?.text() ?? null,
  ];
  for (const [tier, read] of tiers.entries()) {
    const text = await read();
    if (text === null) continue;
    if ((await sha256(text)) !== d.bundleHash) {
      if (tier === 0) {
        cached.delete(key);
        cachedBytes -= text.length;
      }
      if (tier < 2) continue;
      throw new Error(
        `the bundle of deployment ${d.deploymentId} does not match its hash`,
      );
    }
    remember(key, text);
    if (tier === 2)
      await colo()
        ?.put(
          url,
          new Response(text, {
            headers: { "cache-control": "public, max-age=86400" },
          }),
        )
        .catch(() => undefined);
    return JSON.parse(text) as Bundle;
  }
  throw new Error(`deployment ${d.deploymentId} has no bundle`);
};

// Cloudflare allows 10 distinct Dynamic Workers in flight per Durable Object
// and 4 per Worker request, and throws on the next one. Calls past the limit
// wait here for a slot instead; calls to an isolate already in flight count
// once, as Cloudflare counts them.
export class InFlight {
  private running = new Map<string, number>();
  private waiting: Array<() => void> = [];
  constructor(private limit: number) {}

  async run<T>(id: string, call: () => Promise<T>): Promise<T> {
    while (!this.running.has(id) && this.running.size >= this.limit)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running.set(id, (this.running.get(id) ?? 0) + 1);
    try {
      return await call();
    } finally {
      const left = this.running.get(id)! - 1;
      if (left) this.running.set(id, left);
      else {
        this.running.delete(id);
        for (const wake of this.waiting.splice(0)) wake();
      }
    }
  }
}

export const IN_FLIGHT_LIMIT = { durableObject: 10, request: 4 };

const inFlight = new WeakMap<object, InFlight>();
const guard = (ctx: Context) => {
  let found = inFlight.get(ctx);
  if (!found) {
    found = new InFlight(
      ctx.storage ? IN_FLIGHT_LIMIT.durableObject : IN_FLIGHT_LIMIT.request,
    );
    inFlight.set(ctx, found);
  }
  return found;
};

const NO_SECRETS = { version: "none", values: {} };

export const agentWorker = (
  env: Env,
  deployment: Deployment & { caseId?: string },
  ctx: Context,
): { fetch(path: string, init?: RequestInit): Promise<Response> } => {
  const exports = ctx.exports as Exports;
  // Who this call serves, for the Tail Worker's run-log records (apps/tail).
  const scoped = (init?: RequestInit): RequestInit => {
    const headers = new Headers(init?.headers);
    headers.set("x-preprocess-org", deployment.organizationId);
    headers.set("x-preprocess-agent", deployment.agentId);
    headers.set("x-preprocess-deployment", deployment.deploymentId);
    if (deployment.caseId) headers.set("x-preprocess-case", deployment.caseId);
    return { ...init, headers };
  };
  const target = {
    organizationId: deployment.organizationId,
    agentId: deployment.agentId,
    deploymentId: deployment.deploymentId,
  };
  const network = JSON.stringify(deployment.network);
  const call = async (path: string, init?: RequestInit) => {
    const version = env.PLATFORM
      ? await env.PLATFORM.secretsVersion(target)
      : NO_SECRETS.version;
    const id = [
      deployment.organizationId,
      deployment.agentId,
      deployment.deploymentId,
      version,
      (await sha256(network)).slice(0, 16),
    ].join(":");
    const worker = env.LOADER.get(id, async () => {
      const [bundle, secrets] = await Promise.all([
        loadBundle(env, deployment),
        env.PLATFORM ? env.PLATFORM.secretValues(target) : NO_SECRETS,
      ]);
      // A secret changed between the version check and the read: this id
      // must never hold other values than its version names.
      if (secrets.version !== version) throw new SecretsChanged();
      return {
        compatibilityDate: AGENT_COMPATIBILITY.date,
        compatibilityFlags: AGENT_COMPATIBILITY.flags,
        mainModule: bundle.mainModule,
        modules: bundle.modules,
        env: secrets.values,
        globalOutbound: exports.Outbound({
          props: {
            organizationId: deployment.organizationId,
            network: deployment.network,
          },
        }),
        tails: env.TAIL ? [env.TAIL] : [],
      };
    });
    return guard(ctx).run(id, () =>
      worker
        .getEntrypoint(undefined, {
          props: { MCP: exports.McpBroker({ props: target }) },
        })
        .fetch(`https://agent${path}`, scoped(init)),
    );
  };
  return {
    fetch: async (path, init) => {
      try {
        return await call(path, init);
      } catch (error) {
        if (!String(error).includes(SecretsChanged.message)) throw error;
        return call(path, init);
      }
    },
  };
};

class SecretsChanged extends Error {
  static message = "secrets changed while the agent's code loaded";
  constructor() {
    super(SecretsChanged.message);
  }
}
