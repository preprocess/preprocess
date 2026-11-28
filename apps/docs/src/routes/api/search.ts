import { searchPages } from "@preprocess/search/fumadocs";
import type { SearchPage } from "@preprocess/search";
import { createFileRoute } from "@tanstack/react-router";

import { source } from "@/lib/source";

// Every page's text, built once per isolate.
let pages: Promise<SearchPage[]> | undefined;

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(await (pages ??= searchPages(source.getPages())), {
          headers: { "Cache-Control": "public, max-age=300" },
        }),
    },
  },
});
