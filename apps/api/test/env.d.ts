import type { Env as ApiEnv } from "../src/env.ts";

declare global {
  namespace Cloudflare {
    interface Env extends ApiEnv {
      // The install-wide tests' own database (global-setup.ts).
      INSTALL_DB: Hyperdrive;
      INSTALL_DB_SYSTEM: Hyperdrive;
      // The runtime's buckets, bound here too so the organization purge's
      // test can seed and list them (vitest.config.ts).
      RUNS: R2Bucket;
      BUNDLES: R2Bucket;
    }
  }
}
