import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { Suspense, use } from "react";

import { Pre } from "@/components/code-block";
import { SupportArticle } from "@/components/support-article";
import { SupportShell } from "@/components/support-shell";
import { articles } from "@/lib/collections";
import { source } from "@/lib/source";
import { useHelp } from "@/lib/use-help";

const loadArticle = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) throw notFound();
    return { url: page.url, path: page.path, title: page.data.title };
  });

export const Route = createFileRoute("/$category/$slug")({
  loader: async ({ params }) => {
    const data = await loadArticle({ data: [params.category, params.slug] });
    await articles.getPage(data.path)?.preload();
    return data;
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [{ title: `${loaderData.title} · Preprocess Support` }]
      : [],
  }),
  component: ArticlePage,
});

// Articles are plain Markdown: Fumadocs' default elements and the docs' code
// blocks, no MDX components.
const components = { ...defaultMdxComponents, pre: Pre };

function Content({ path, url }: { path: string; url: string }) {
  const help = useHelp();
  const page = articles.getPage(path);
  if (!page) throw new Error(`Unknown article: ${path}`);
  const { toc } = use(page.load());
  const Body = page.body;
  return (
    <SupportShell help={help} title={page.title} toc={toc}>
      <SupportArticle
        description={page.description}
        help={help}
        title={page.title}
        url={url}
      >
        <Body components={components} />
      </SupportArticle>
    </SupportShell>
  );
}

function ArticlePage() {
  const { path, url } = Route.useLoaderData();
  return (
    <Suspense>
      <Content path={path} url={url} />
    </Suspense>
  );
}
