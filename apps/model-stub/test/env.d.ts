import type * as worker from "../src/index.ts";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof worker;
    }
  }
}
