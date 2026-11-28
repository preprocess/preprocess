import { createRequire } from "node:module";
import path from "node:path";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { buildSync } from "esbuild";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const root = import.meta.dirname;
const dist = path.join(root, "test/dist");

// The sample agents are bundled the way `preprocess deploy` bundles them, and
// the tests store them in BUNDLES as a deploy does.
const bundle = (entry: string, out: string) =>
  buildSync({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(dist, out),
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2023",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["module", "main"],
    external: ["cloudflare:*", "node:*"],
    logLevel: "warning",
  });
bundle("../model-stub/src/index.ts", "model-stub.js");
bundle("test/fixtures/sample-agent.ts", "sample-agent.js");
bundle("test/fixtures/invoice-agent.ts", "invoice-agent.js");
bundle("test/fixtures/failing-agent.ts", "failing-agent.js");
bundle("test/fixtures/approval-agent.ts", "approval-agent.js");
bundle("test/fixtures/sandbox-agent.ts", "sandbox-agent.js");
bundle("test/fixtures/medium-sandbox-agent.ts", "medium-sandbox-agent.js");
bundle("test/fixtures/mcp-service.ts", "mcp-service.js");

const worker = (name: string, extra: object = {}) => ({
  name,
  modules: true,
  scriptPath: path.join(dist, `${name}.js`),
  compatibilityDate: "2026-07-26",
  compatibilityFlags: ["nodejs_compat"],
  ...extra,
});

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Our cloud's run mode, so model, decide and OCR calls are priced.
        bindings: {
          MODEL_SERVICE_URL: "http://model-stub.test",
          PREPROCESS_REGION: "us",
        },
        // The runtime's fetches: the model service, and the internet the
        // agent's code reaches past the network rules.
        outboundService: "internet",
        workers: [
          {
            name: "internet",
            modules: true,
            compatibilityDate: "2026-07-26",
            serviceBindings: { MODEL: "model-stub" },
            script: `export default {
  fetch(request, env) {
    const host = new URL(request.url).hostname;
    if (host === "model-stub.test") return env.MODEL.fetch(request);
    return new Response("reached " + host);
  },
};`,
          },
          worker("model-stub"),
          // apps/tail's place: the tests read run logs from capture instead.
          {
            name: "tail",
            modules: true,
            compatibilityDate: "2026-07-26",
            script: "export default { tail() {} };",
          },
          worker("mcp-service"),
          // The API's internal entrypoint, which the runtime reports to. The
          // tests read reports from run capture instead.
          {
            name: "platform",
            modules: true,
            compatibilityDate: "2026-07-26",
            script: `import { WorkerEntrypoint } from "cloudflare:workers";
const allowed = new Map();
const events = [];
const layers = [];
// What \`deploy\` in test/deploy.ts gives each deployment, under a version that
// moves on every change, as the API's secrets version does.
const secrets = new Map();
let versions = 0;
const ref = (d) => d.organizationId + ":" + d.agentId + ":" + d.deploymentId;
export class Platform extends WorkerEntrypoint {
  async setSecrets(d, values) { secrets.set(ref(d), { version: "v" + ++versions, values }); }
  async secretsVersion(d) { return secrets.get(ref(d))?.version ?? "none"; }
  async secretValues(d) { return secrets.get(ref(d)) ?? { version: "none", values: {} }; }
  async caseEvent() {}
  async modelEndpoints() { return {}; }
  // Tests cap an organization at n more passes of the spending gate.
  async limitSpend(organizationId, n) { allowed.set(organizationId, n); }
  async spendGate(organizationId) {
    const n = allowed.get(organizationId);
    if (n === undefined) return "ok";
    if (n <= 0) return "spending_limit_reached";
    allowed.set(organizationId, n - 1);
    return "ok";
  }
  async ocrFile() { throw new Error("no OCR in the runtime tests"); }
  async evalEvent() {}
  // Sandbox lifecycle events, which tests read back with sandboxEvents().
  async sandboxGate(organizationId, size) {
    return organizationId === "org_capped" && size !== "small" ? "sandbox_size_not_allowed" : "ok";
  }
  async sandboxEvent(event) { events.push(event); }
  async sandboxEvents() { return events; }
  // Custom environment builds, which tests read back with layerResults().
  async sandboxLayer() { return null; }
  async sandboxLayerBuilt(built) { layers.push(built); return { ok: true }; }
  async layerResults() { return layers; }
}
export default { fetch: () => new Response("platform") };`,
          },
        ],
        serviceBindings: {
          TAIL: "tail",
          MCP_SERVICE: { name: "mcp-service", entrypoint: "McpService" },
          PLATFORM: { name: "platform", entrypoint: "Platform" },
        },
      },
    }),
  ],
  // Exactly "zod": @cloudflare/sandbox imports "zod/mini", its own copy.
  resolve: { alias: [{ find: /^zod$/, replacement: require.resolve("zod") }] },
  // The first test pays for loading Pi into a fresh isolate.
  test: { testTimeout: 30_000 },
});
