import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { localDatabaseUrl, localRoleUrl } from "@preprocess/db/migrate";
import { buildSync } from "esbuild";
import { defineConfig } from "vitest/config";

import { fakeGithub, GITHUB_API, GITHUB_WEB } from "./test/fake-github.ts";
import { fakeIdp, isFakeIdp } from "./test/fake-idp.ts";
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

// The runtime and the model stub run beside the API, as in `pnpm dev`; the
// sample agents are bundled the way `preprocess deploy` bundles one.
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
bundle("../model-stub/src/index.ts", "model-stub.js");
bundle("test/fixtures/sample-agent.ts", "sample-agent.js");
bundle("test/fixtures/crm-agent.ts", "crm-agent.js");
bundle("test/fixtures/fake-builder.ts", "fake-builder.js");
bundle("test/fixtures/network-agent.ts", "network-agent.js");
bundle("test/fixtures/groups-agent.ts", "groups-agent.js");
bundle("test/fixtures/approvals-agent.ts", "approvals-agent.js");
bundle("test/fixtures/scheduled-agent.ts", "scheduled-agent.js");
bundle("test/fixtures/sandbox-agent.ts", "sandbox-agent.js");
bundle("test/fixtures/setup-agent.ts", "setup-agent.js");

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
const githubKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ format: "pem", type: "pkcs8" })
  .toString();

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        hyperdrives: {
          DB: localRoleUrl(url, "preprocess_app"),
          DB_SYSTEM: localRoleUrl(url, "preprocess_system"),
        },
        bindings: {
          MODEL_SERVICE_URL: "http://model-stub.test",
          BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
          AUDIT_SIGNING_KEY: auditKey,
          GITHUB_APP_ID: "1",
          GITHUB_APP_SLUG: "preprocess-test",
          GITHUB_APP_PRIVATE_KEY: githubKey,
          GITHUB_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
          GITHUB_CLIENT_ID: "Iv1.test",
          GITHUB_CLIENT_SECRET: "test",
          GITHUB_API_URL: GITHUB_API,
          GITHUB_URL: GITHUB_WEB,
          GITHUB_BUILD_TIMEOUT_SECONDS: "1",
        },
        // The internet the API reaches: GitHub, an SSO identity provider
        // with the DNS it checks domains against, and a remote MCP server
        // behind OAuth.
        outboundService: (request: Request) => {
          const url = new URL(request.url);
          if ([GITHUB_API, GITHUB_WEB].includes(url.origin))
            return fakeGithub(request);
          if (isFakeIdp(url)) return fakeIdp(request);
          return fakeMcp(request);
        },
        serviceBindings: {
          RUNTIME: "preprocess-runtime-development",
          BUILDER: { name: "fake-builder", entrypoint: "Builder" },
          // The sandboxed renderer needs Docker; tests pass a stub as
          // env.PDF_RENDER instead.
          PDF_RENDER: () => new Response("pdf-render stub", { status: 501 }),
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
            r2Buckets: { RUNS: "runs", BUNDLES: "bundles" },
            workerLoaders: { LOADER: {} },
            serviceBindings: {
              // The test Worker is the API: its McpService and Platform
              // entrypoints.
              MCP_SERVICE: {
                name: "vitest-plugin-runner-",
                entrypoint: "McpService",
              },
              PLATFORM: {
                name: "vitest-plugin-runner-",
                entrypoint: "Platform",
              },
              TAIL: "tail",
            },
            // The model service, and the internet the agent's code reaches
            // past the network rules.
            outboundService: "internet",
          }),
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
          // apps/tail's place; its records are tested in apps/tail.
          {
            name: "tail",
            modules: true,
            compatibilityDate: "2026-07-26",
            script: "export default { tail() {} };",
          },
          worker("model-stub"),
          worker("fake-builder", {
            bindings: {
              SAMPLE_AGENT: readFileSync(
                path.join(dist, "sample-agent.js"),
                "utf8",
              ),
            },
          }),
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
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ["@better-auth/sso > samlify"],
          rolldownOptions: {
            platform: "node",
            external: [/^node:/, ...builtinModules],
          },
        },
      },
    },
    // samlify (the SSO plugin's SAML) is CommonJS that default-imports
    // CommonJS; prebundling gives it the interop a deploy's bundle does.
  },
});
