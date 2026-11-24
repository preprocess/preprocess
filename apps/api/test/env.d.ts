import type { Env as ApiEnv } from "../src/env.ts";

declare global {
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- merges the API's bindings into the runtime's Env
    interface Env extends ApiEnv {}
  }
}
