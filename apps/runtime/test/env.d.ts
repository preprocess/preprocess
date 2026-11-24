import type { Env as RuntimeEnv } from "../src/env.ts";

declare global {
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- merges the runtime's bindings into the test Env
    interface Env extends RuntimeEnv {}
  }
}
