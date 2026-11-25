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
import { NotFound } from "@/components/not-found";
import { TreeContext } from "@/components/page-tree";
import { docs } from "@/lib/collections";
import { source } from "@/lib/source";

const loadPage = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const pageTree = await source.serializePageTree(source.getPageTree());
    const page = source.getPage(slugs);
    if (!page) throw notFound({ data: { apiUrl: env.API_URL, pageTree } });
    if (page.type === "openapi")
      return {
        type: "openapi" as const,
        url: page.url,
        apiUrl: env.API_URL,
        title: page.data.title,
        pageTree,
        props: page.data.getOpenAPIPageProps(),
      };
    return {
      type: "docs" as const,
      url: page.url,
      path: page.path,
      apiUrl: env.API_URL,
      markdown: await page.data.getText("processed"),
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
  notFoundComponent: ({ data }) => <NotFound data={data} />,
});

function Content({
  appUrl,
  markdown,
  path,
  tree,
  url,
}: {
  appUrl: string;
  markdown: string;
  path: string;
  tree: Parameters<typeof DocsArticle>[0]["tree"];
  url: string;
}) {
  const page = docs.getPage(path);
  if (!page) throw new Error(`Unknown page: ${path}`);
  const { toc } = use(page.load());
  const MDX = page.body;
  return (
    <DocsShell appUrl={appUrl} markdown={markdown} toc={toc} tree={tree}>
      <DocsArticle
        description={page.description}
        layout={url === "/" ? "home" : "guide"}
        title={page.title}
        tree={tree}
        url={url}
      >
        <TreeContext value={tree}>
          <MDX components={useMDXComponents()} />
        </TreeContext>
      </DocsArticle>
    </DocsShell>
  );
}

function Page() {
  const page = useFumadocsLoader(Route.useLoaderData());
  const appUrl = new URL(page.apiUrl).origin;
  if (page.type === "openapi")
    return (
      <DocsShell appUrl={appUrl} tree={page.pageTree}>
        <DocsArticle
          layout="api"
          title={page.title}
          tree={page.pageTree}
          url={page.url}
        >
          <div className="not-typeset">
            <OpenAPIPage {...page.props} />
          </div>
        </DocsArticle>
      </DocsShell>
    );
  return (
    <ApiUrlContext value={page.apiUrl}>
      <Suspense>
        <Content
          appUrl={appUrl}
          markdown={page.markdown}
          path={page.path}
          tree={page.pageTree}
          url={page.url}
        />
      </Suspense>
    </ApiUrlContext>
  );
}
