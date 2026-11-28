import type { Env as ApiEnv } from "../src/env.ts";

declare global {
  namespace Cloudflare {
    interface Env extends ApiEnv {
      // The install-wide tests' own database (global-setup.ts).
      INSTALL_DB: Hyperdrive;
      INSTALL_DB_SYSTEM: Hyperdrive;
    }
  }
}
