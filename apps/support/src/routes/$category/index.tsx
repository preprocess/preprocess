import { createFileRoute, notFound } from "@tanstack/react-router";

import { ArticleList } from "@/components/page-lists";
import { SupportArticle } from "@/components/support-article";
import { SupportShell } from "@/components/support-shell";
import { categories } from "@/lib/categories";
import { useHelp } from "@/lib/use-help";

export const Route = createFileRoute("/$category/")({
  loader: ({ params }) => {
    const category = categories.find((c) => c.slug === params.category);
    if (!category) throw notFound();
    return category;
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [{ title: `${loaderData.title} · Preprocess Support` }]
      : [],
  }),
  component: CategoryPage,
});

// A skeleton until Design's category page lands (PLAT-143): the category's
// articles in the docs' prose.
function CategoryPage() {
  const help = useHelp();
  const { slug } = Route.useLoaderData();
  const category = help.categories.find((c) => c.slug === slug);
  if (!category) return null;
  return (
    <SupportShell help={help} title={category.title}>
      <SupportArticle help={help} title={category.title} url={category.url}>
        <ArticleList articles={category.articles} />
      </SupportArticle>
    </SupportShell>
  );
}
