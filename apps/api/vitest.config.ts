import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { localDatabaseUrl, localRoleUrl } from "@preprocess/db/migrate";
import { defineConfig } from "vitest/config";

// pg require()s pg-protocol, and Vitest resolves that require with the
// "import" condition, which points at an ES module. Pin it to the CommonJS
// build pg expects. pg also loads its Workers socket from pg-cloudflare's
// "workerd" export, which Vitest's resolver does not pick.
const pgRequire = createRequire(createRequire(import.meta.url).resolve("pg"));

// A fresh database per run (test/global-setup.ts), reached as the API reaches
// its own: DB as preprocess_app, DB_SYSTEM as preprocess_system.
const url =
  process.env.TEST_DATABASE_URL ?? localDatabaseUrl("preprocess_api_test");

const auditKey = generateKeyPairSync("ed25519")
  .privateKey.export({ format: "der", type: "pkcs8" })
  .toString("base64");

// Tests run inside the Workers runtime with the API's local bindings (the
// generated wrangler.jsonc). The user Worker is not part of the test runtime,
// so its service binding answers with a fixed reply.
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
          BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
          AUDIT_SIGNING_KEY: auditKey,
        },
        serviceBindings: {
          LOCAL_USER_WORKER: () => Response.json({ worker: "test" }),
        },
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
