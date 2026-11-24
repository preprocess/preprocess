import type { Namespace } from "../../namespace-local/src/index.ts";
import type { Env as RuntimeEnv } from "../src/env.ts";

declare global {
  namespace Cloudflare {
    interface Env extends RuntimeEnv {
      NAMESPACE_ADMIN: Service<Namespace>;
    }
  }
}
