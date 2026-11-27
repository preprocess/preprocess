import { createFileRoute } from "@tanstack/react-router";
import type { StructuredData } from "fumadocs-core/mdx-plugins";

import { plainText, type SearchPage } from "@/lib/search";
import { source } from "@/lib/source";

// Every page's text, built once per isolate. Table rows are left out: they
// read as noise in a result list, and their page still matches on its
// headings and prose.
async function buildPages(): Promise<SearchPage[]> {
  return Promise.all(
    source.getPages().map(async (page) => {
      const data = page.data as {
        title?: string;
        description?: string;
        structuredData?: StructuredData | (() => Promise<StructuredData>);
        load?: () => Promise<{ structuredData: StructuredData }>;
      };
      const structured =
        typeof data.structuredData === "function"
          ? await data.structuredData()
          : (data.structuredData ?? (await data.load?.())?.structuredData);
      return {
        url: page.url,
        title: data.title ?? page.url,
        description: plainText(data.description ?? ""),
        headings: (structured?.headings ?? []).map((h) => ({
          id: h.id,
          text: plainText(h.content),
        })),
        paragraphs: (structured?.contents ?? [])
          .filter(
            (c) => !("table" in c) && !c.content.trimStart().startsWith("|"),
          )
          .map((c) => ({ heading: c.heading, text: plainText(c.content) }))
          .filter((c) => c.text.length > 0),
      };
    }),
  );
}

let pages: Promise<SearchPage[]> | undefined;

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(await (pages ??= buildPages()), {
          headers: { "Cache-Control": "public, max-age=300" },
        }),
    },
  },
});
