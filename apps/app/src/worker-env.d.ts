declare global {
  namespace Cloudflare {
    interface Env {
      /** The API Worker: Better Auth under /api/auth and the /v1 API. */
      API: Fetcher;
      /** Set on our cloud, unset on a self-hosted install (spec 16). */
      PREPROCESS_REGION?: string;
    }
  }
}

export {};
