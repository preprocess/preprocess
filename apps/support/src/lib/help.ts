import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import type * as PageTree from "fumadocs-core/page-tree";

import { categories } from "./categories";
import { source } from "./source";

export type HelpArticle = { url: string; title: string; description: string };

export type HelpCategory = {
  slug: string;
  title: string;
  url: string;
  articles: HelpArticle[];
};

// What every page draws its shell from: the categories with their articles
// in meta.json order, and where the shell links out to.
export type HelpCenter = {
  categories: HelpCategory[];
  appUrl: string;
  docsUrl: string;
  statusUrl: string | null;
};

export const loadHelpCenter = createServerFn({ method: "GET" }).handler(
  (): HelpCenter => {
    const folders = source
      .getPageTree()
      .children.filter(
        (node): node is PageTree.Folder => node.type === "folder",
      );
    return {
      categories: categories.map(({ slug, title }) => {
        const folder = folders.find((node) =>
          node.children.some(
            (child) =>
              child.type === "page" && child.url.startsWith(`/${slug}/`),
          ),
        );
        return {
          slug,
          title,
          url: `/${slug}`,
          articles: (folder?.children ?? []).flatMap((node) => {
            const page =
              node.type === "page"
                ? source.getPage(node.url.slice(1).split("/"))
                : undefined;
            return page
              ? [
                  {
                    url: page.url,
                    title: page.data.title,
                    description: page.data.description ?? "",
                  },
                ]
              : [];
          }),
        };
      }),
      appUrl: env.APP_URL,
      docsUrl: env.DOCS_URL,
      statusUrl: env.STATUS_URL ?? null,
    };
  },
);
