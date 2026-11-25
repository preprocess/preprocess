import { env } from "cloudflare:workers";
import type { Document } from "fumadocs-openapi";
import { createOpenAPI } from "fumadocs-openapi/server";

import document from "../../openapi.json";

// The reference is generated from the API's own OpenAPI document (written by
// `pnpm openapi`). Its server URL comes from the Worker's API_URL, so each
// deployment, a self-hosted one included, documents its own origin.
export const openapi = createOpenAPI({
  input: {
    preprocess: () => ({
      ...(document as object as Document),
      servers: [{ url: env.API_URL }],
    }),
  },
});
