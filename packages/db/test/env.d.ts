import type { DbEnv } from "../src/client.ts";

declare global {
  namespace Cloudflare {
    interface Env extends DbEnv {
      DB_ADMIN: Hyperdrive;
      DB_MEMBER: Hyperdrive;
      DB_BYPASS: Hyperdrive;
    }
  }
}
