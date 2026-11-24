import { createRequire } from "node:module";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// pg require()s pg-protocol, and Vitest resolves that require with the
// "import" condition, which points at an ES module. Pin it to the CommonJS
// build pg expects.
const pgRequire = createRequire(createRequire(import.meta.url).resolve("pg"));

// Tests run inside the Workers runtime with the API's local bindings (the
// generated wrangler.jsonc): its Durable Object, R2 bucket and queue. The user
// Worker is not part of the test runtime, so its service binding answers with
// a fixed reply.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        serviceBindings: {
          LOCAL_USER_WORKER: () => Response.json({ worker: "test" }),
        },
      },
    }),
  ],
  resolve: {
    alias: { "pg-protocol": pgRequire.resolve("pg-protocol") },
  },
});
