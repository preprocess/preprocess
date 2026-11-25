declare global {
  namespace Cloudflare {
    interface Env {
      /** The API Worker: Better Auth under /api/auth and the /v1 API. */
      API: Fetcher;
    }
  }
}

export {};
