import { createRequire } from "node:module";
import path from "node:path";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { buildSync } from "esbuild";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const root = import.meta.dirname;
const dist = path.join(root, "test/dist");

// The local namespace and outbound Workers run beside the runtime, as in
// `pnpm dev`; the sample agent is bundled the way `preprocess deploy` will.
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
bundle("../namespace-local/src/index.ts", "namespace-local.js");
bundle("../outbound/src/index.ts", "outbound.js");
bundle("../model-stub/src/index.ts", "model-stub.js");
bundle("test/fixtures/sample-agent.ts", "sample-agent.js");
bundle("test/fixtures/invoice-agent.ts", "invoice-agent.js");
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
        bindings: { MODEL_SERVICE_URL: "http://model-stub.test" },
        // Every fetch the runtime makes goes to the model service.
        outboundService: "model-stub",
        workers: [
          worker("namespace-local", {
            workerLoaders: { LOADER: {} },
            r2Buckets: { SCRIPTS: "scripts" },
            serviceBindings: {
              OUTBOUND: { name: "outbound", entrypoint: "Egress" },
            },
          }),
          worker("outbound", {
            // The internet, as the agent's code sees it past the rules.
            outboundService: (request: Request) =>
              new Response(`reached ${new URL(request.url).hostname}`),
          }),
          worker("model-stub"),
          worker("mcp-service"),
          // The API's internal entrypoint, which the runtime reports to. The
          // tests read reports from run capture instead.
          {
            name: "platform",
            modules: true,
            compatibilityDate: "2026-07-26",
            script: `import { WorkerEntrypoint } from "cloudflare:workers";
const allowed = new Map();
export class Platform extends WorkerEntrypoint {
  async caseEvent() {}
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
}
export default { fetch: () => new Response("platform") };`,
          },
        ],
        serviceBindings: {
          LOCAL_NAMESPACE: "namespace-local",
          NAMESPACE_ADMIN: { name: "namespace-local", entrypoint: "Namespace" },
          MCP_SERVICE: { name: "mcp-service", entrypoint: "McpService" },
          PLATFORM: { name: "platform", entrypoint: "Platform" },
        },
      },
    }),
  ],
  resolve: { alias: { zod: require.resolve("zod") } },
  // The first test pays for loading Pi into a fresh isolate.
  test: { testTimeout: 30_000 },
});
