import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { localDatabaseUrl, localRoleUrl } from "@preprocess/db/migrate";
import { buildSync } from "esbuild";
import { defineConfig } from "vitest/config";

import { fakeMcp } from "./test/fake-mcp.ts";

const require = createRequire(import.meta.url);
// pg require()s pg-protocol, and Vitest resolves that require with the
// "import" condition, which points at an ES module. Pin it to the CommonJS
// build pg expects. pg also loads its Workers socket from pg-cloudflare's
// "workerd" export, which Vitest's resolver does not pick.
const pgRequire = createRequire(require.resolve("pg"));

const root = import.meta.dirname;
const dist = path.join(root, "test/dist");
const url =
  process.env.TEST_DATABASE_URL ?? localDatabaseUrl("preprocess_api_test");

// The runtime, the local namespace, the outbound Worker and the model stub
// run beside the API, as in `pnpm dev`; the sample agent is bundled the way
// `preprocess deploy` bundles one.
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
    loader: { ".png": "dataurl" },
    logLevel: "warning",
  });
bundle("../runtime/src/index.ts", "runtime.js");
bundle("../namespace-local/src/index.ts", "namespace-local.js");
bundle("../outbound/src/index.ts", "outbound.js");
bundle("../model-stub/src/index.ts", "model-stub.js");
bundle("test/fixtures/sample-agent.ts", "sample-agent.js");
bundle("test/fixtures/crm-agent.ts", "crm-agent.js");

const worker = (name: string, extra: object = {}) => ({
  name,
  modules: true,
  scriptPath: path.join(dist, `${name}.js`),
  compatibilityDate: "2026-07-26",
  compatibilityFlags: ["nodejs_compat"],
  ...extra,
});

const auditKey = generateKeyPairSync("ed25519")
  .privateKey.export({ format: "der", type: "pkcs8" })
  .toString("base64");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        hyperdrives: {
          DB: localRoleUrl(url, "preprocess_app"),
          DB_SYSTEM: localRoleUrl(url, "preprocess_system"),
        },
        // The API's own fetches go to the model stub, as the runtime's do.
        outboundService: "model-stub",
        bindings: {
          MODEL_SERVICE_URL: "http://model-stub.test",
          BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
          AUDIT_SIGNING_KEY: auditKey,
        },
        // The internet the API reaches: a remote MCP server behind OAuth.
        outboundService: fakeMcp,
        serviceBindings: {
          LOCAL_USER_WORKER: () => Response.json({ worker: "test" }),
          RUNTIME: "preprocess-runtime-development",
          // The sandboxed renderer needs Docker; tests pass a stub as
          // env.PDF_RENDER instead.
          PDF_RENDER: () => new Response("pdf-render stub", { status: 501 }),
          LOCAL_NAMESPACE: {
            name: "preprocess-namespace-development",
            entrypoint: "Namespace",
          },
        },
        workers: [
          worker("runtime", {
            name: "preprocess-runtime-development",
            bindings: {
              STAGE: "test",
              MODEL_SERVICE_URL: "http://model-stub.test",
              MODEL_SERVICE_KEY: "test",
            },
            durableObjects: {
              CASE_RUNTIME: { className: "CaseRuntime", useSQLite: true },
            },
            r2Buckets: { RUNS: "runs" },
            serviceBindings: {
              LOCAL_NAMESPACE: "preprocess-namespace-development",
              // The test Worker is the API: its McpService entrypoint.
              MCP_SERVICE: {
                name: "vitest-plugin-runner-",
                entrypoint: "McpService",
              },
            },
            outboundService: "model-stub",
          }),
          worker("namespace-local", {
            name: "preprocess-namespace-development",
            workerLoaders: { LOADER: {} },
            r2Buckets: { SCRIPTS: "scripts" },
            serviceBindings: {
              OUTBOUND: { name: "outbound", entrypoint: "Egress" },
            },
          }),
          worker("outbound", {
            outboundService: (request: Request) =>
              new Response(`reached ${new URL(request.url).hostname}`),
          }),
          worker("model-stub"),
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "pg-protocol": pgRequire.resolve("pg-protocol"),
      "pg-cloudflare": path.join(
        path.dirname(pgRequire.resolve("pg-cloudflare/package.json")),
        "dist/index.js",
      ),
    },
  },
  test: {
    globalSetup: ["./test/global-setup.ts"],
  },
});
