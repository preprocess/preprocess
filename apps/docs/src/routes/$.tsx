import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { Suspense, use } from "react";

import { OpenAPIPage } from "@/components/api-page";
import { ApiUrlContext } from "@/components/configured";
import { DocsArticle } from "@/components/docs-article";
import { DocsShell } from "@/components/docs-shell";
import { useMDXComponents } from "@/components/mdx";
import { docs } from "@/lib/collections";
import { source } from "@/lib/source";

const loadPage = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) throw notFound();
    const pageTree = await source.serializePageTree(source.getPageTree());
    if (page.type === "openapi")
      return {
        type: "openapi" as const,
        url: page.url,
        title: page.data.title,
        pageTree,
        props: page.data.getOpenAPIPageProps(),
      };
    return {
      type: "docs" as const,
      url: page.url,
      path: page.path,
      apiUrl: env.API_URL,
      pageTree,
    };
  });

export const Route = createFileRoute("/$")({
  loader: async ({ params }) => {
    const data = await loadPage({
      data: params._splat?.split("/").filter(Boolean) ?? [],
    });
    if (data.type === "docs") await docs.getPage(data.path)?.preload();
    return data;
  },
  component: Page,
});

function Content({
  path,
  tree,
  url,
}: {
  path: string;
  tree: Parameters<typeof DocsArticle>[0]["tree"];
  url: string;
}) {
  const page = docs.getPage(path);
  if (!page) throw new Error(`Unknown page: ${path}`);
  const { toc } = use(page.load());
  const MDX = page.body;
  return (
    <DocsArticle
      description={page.description}
      title={page.title}
      toc={toc}
      tree={tree}
      url={url}
    >
      <MDX components={useMDXComponents()} />
    </DocsArticle>
  );
}

function Page() {
  const page = useFumadocsLoader(Route.useLoaderData());
  return (
    <DocsShell tree={page.pageTree}>
      {page.type === "openapi" ? (
        <DocsArticle title={page.title} tree={page.pageTree} url={page.url}>
          <div className="not-typeset">
            <OpenAPIPage {...page.props} />
          </div>
        </DocsArticle>
      ) : (
        <ApiUrlContext value={page.apiUrl}>
          <Suspense>
            <Content path={page.path} tree={page.pageTree} url={page.url} />
          </Suspense>
        </ApiUrlContext>
      )}
    </DocsShell>
  );
}
