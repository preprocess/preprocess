declare global {
  namespace Cloudflare {
    interface Env {
      // The API's public origin with /v1, which the reference documents.
      API_URL: string;
    }
  }
}

export {};
