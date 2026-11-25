import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/notebook/page";
import { Suspense, use } from "react";

import { OpenAPIPage } from "@/components/api-page";
import { useMDXComponents } from "@/components/mdx";
import { docs } from "@/lib/collections";
import { baseOptions } from "@/lib/layout";
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
        title: page.data.title,
        pageTree,
        props: page.data.getOpenAPIPageProps(),
      };
    return { type: "docs" as const, path: page.path, pageTree };
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

function Content({ path }: { path: string }) {
  const page = docs.getPage(path);
  if (!page) throw new Error(`Unknown page: ${path}`);
  const { toc } = use(page.load());
  const MDX = page.body;
  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <DocsBody>
        <MDX components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

function Page() {
  const page = useFumadocsLoader(Route.useLoaderData());
  const base = baseOptions();
  return (
    <DocsLayout
      {...base}
      nav={{ ...base.nav, mode: "top" }}
      tree={page.pageTree}
    >
      {page.type === "openapi" ? (
        <DocsPage full>
          <DocsTitle>{page.title}</DocsTitle>
          <DocsBody>
            <OpenAPIPage {...page.props} />
          </DocsBody>
        </DocsPage>
      ) : (
        <Suspense>
          <Content path={page.path} />
        </Suspense>
      )}
    </DocsLayout>
  );
}
