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
        ],
        serviceBindings: {
          LOCAL_NAMESPACE: "namespace-local",
          NAMESPACE_ADMIN: { name: "namespace-local", entrypoint: "Namespace" },
        },
      },
    }),
  ],
  resolve: { alias: { zod: require.resolve("zod") } },
  // The first test pays for loading Pi into a fresh isolate.
  test: { testTimeout: 30_000 },
});
