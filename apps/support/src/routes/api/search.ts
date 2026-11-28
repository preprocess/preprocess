import type { SearchPage } from "@preprocess/search";
import { searchPages } from "@preprocess/search/fumadocs";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { source } from "@/lib/source";

// The help center's search index: its own articles, built once per isolate,
// and the docs pages from the docs Worker's /api/search with their URLs made
// absolute on DOCS_URL. The browser indexes each list on its own, so help
// articles group before docs. A docs index that can't be read leaves the
// docs out until the next try, 30 seconds on, and never fails the articles.
export type HelpSearchIndex = { articles: SearchPage[]; docs: SearchPage[] };

const docsTtl = 5 * 60_000;
const retryTtl = 30_000;

let articles: Promise<SearchPage[]> | undefined;
let docs: { pages: Promise<SearchPage[]>; until: number } | undefined;

async function fetchDocs(docsUrl: string): Promise<SearchPage[]> {
  const response = await fetch(new URL("/api/search", docsUrl), {
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok)
    throw new Error(
      `docs search index: ${response.status} ${(await response.text()).slice(0, 200)}`,
    );
  const pages = await response.json<SearchPage[]>();
  return pages.map((page) => ({
    ...page,
    url: new URL(page.url, docsUrl).href,
  }));
}

function docsPages() {
  const now = Date.now();
  if (!docs || docs.until < now) {
    const pages = fetchDocs(env.DOCS_URL);
    docs = { pages, until: now + docsTtl };
    pages.catch((error: unknown) => {
      console.error(String(error));
      if (docs?.pages === pages) docs.until = Date.now() + retryTtl;
    });
  }
  return docs.pages.catch((): SearchPage[] => []);
}

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: async () => {
        const index: HelpSearchIndex = {
          articles: await (articles ??= searchPages(source.getPages())),
          docs: await docsPages(),
        };
        // Without the docs, browsers ask again soon.
        return Response.json(index, {
          headers: {
            "Cache-Control": `public, max-age=${index.docs.length ? 300 : 30}`,
          },
        });
      },
    },
  },
});
