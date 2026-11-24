declare global {
  namespace Cloudflare {
    interface Env {
      WORKOS_CLIENT_ID: string;
      WORKOS_API_KEY: string;
      WORKOS_COOKIE_PASSWORD: string;
      WORKOS_REDIRECT_URI: string;
    }
  }
}

export {};
