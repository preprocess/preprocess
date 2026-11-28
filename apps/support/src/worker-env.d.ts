declare global {
  namespace Cloudflare {
    interface Env {
      // The app's origin, for the way into the app.
      APP_URL: string;
      // The docs site's origin: the help center links to it and merges its
      // search index (/api/search) into its own.
      DOCS_URL: string;
      // Our status page, set only on our own stages (spec 16).
      STATUS_URL?: string;
    }
  }
}

export {};
