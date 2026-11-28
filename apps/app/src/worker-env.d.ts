declare global {
  namespace Cloudflare {
    interface Env {
      /** The API Worker: Better Auth under /api/auth and the /v1 API. */
      API: Fetcher;
      /** Set on our cloud, unset on a self-hosted install (spec 16). */
      PREPROCESS_REGION?: string;
      /** Set when Google sign-in is configured; shows its button. */
      GOOGLE_CLIENT_ID?: string;
      /** PostHog's public project key and host (features/monitoring). */
      POSTHOG_KEY?: string;
      POSTHOG_HOST?: string;
      /** The docs site the app links to. */
      DOCS_URL?: string;
      /** Our status page; set only on our own stages (spec 16). */
      STATUS_URL?: string;
    }
  }
}

export {};
