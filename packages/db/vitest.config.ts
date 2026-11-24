import { createRequire } from "node:module";
import path from "node:path";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

import { localDatabaseUrl, localRoleUrl } from "./scripts/migrate-lib.ts";

const pgRequire = createRequire(createRequire(import.meta.url).resolve("pg"));

// Tests run in the Workers runtime against a fresh local database
// (test/global-setup.ts), reached the way the API reaches it: DB as
// preprocess_app and DB_SYSTEM as preprocess_system. DB_ADMIN (the local
// superuser) exists only here, to stand in for an attacker with table access.
const url =
  process.env.TEST_DATABASE_URL ?? localDatabaseUrl("preprocess_test_db");

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-07-26",
        compatibilityFlags: ["nodejs_compat"],
        hyperdrives: {
          DB: localRoleUrl(url, "preprocess_app"),
          DB_SYSTEM: localRoleUrl(url, "preprocess_system"),
          DB_ADMIN: url,
        },
      },
    }),
  ],
  resolve: {
    // pg loads its Workers socket from pg-cloudflare's "workerd" export, which
    // Vitest's resolver does not pick; point it at that build directly.
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
    provide: { databaseUrl: url },
  },
});
