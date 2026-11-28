declare global {
  namespace Cloudflare {
    interface Env {
      // The app's origin, for the way into the app.
      APP_URL: string;
      // The docs site's origin, which makes the docs results' URLs absolute.
      DOCS_URL: string;
      /** The docs Worker, which serves the search index the help center merges. */
      DOCS: Fetcher;
      // Our status page, set only on our own stages (spec 16).
      STATUS_URL?: string;
    }
  }
}

export {};
