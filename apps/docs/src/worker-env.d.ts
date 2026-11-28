declare global {
  namespace Cloudflare {
    interface Env {
      // The API's public origin with /v1, which the reference documents.
      API_URL: string;
      // Our status page, set only on our own stages (spec 16).
      STATUS_URL?: string;
    }
  }
}

export {};
