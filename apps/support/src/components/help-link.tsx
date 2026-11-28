import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";

import type { HelpCenter } from "@/lib/help";

// A link to a help center page through the router: home, contact, a
// category or an article.
export function HelpLink({
  url,
  ...props
}: { url: string } & ComponentProps<"a">) {
  const [category, slug] = url.slice(1).split("/");
  if (!category) return <Link {...props} to="/" />;
  if (category === "contact") return <Link {...props} to="/contact" />;
  if (!slug) return <Link {...props} params={{ category }} to="/$category" />;
  return <Link {...props} params={{ category, slug }} to="/$category/$slug" />;
}

export type Crumb = { label: string; url?: string };

// Where a page sits, ending with the page: the help center, its category,
// then the article.
export function crumbsFor(help: HelpCenter, pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: "Help center", url: "/" }];
  if (pathname === "/contact") crumbs.push({ label: "Contact support" });
  const category = help.categories.find(
    (c) => pathname === c.url || pathname.startsWith(`${c.url}/`),
  );
  if (!category) return crumbs;
  crumbs.push({ label: category.title, url: category.url });
  const article = category.articles.find((a) => a.url === pathname);
  if (article) crumbs.push({ label: article.title });
  return crumbs;
}
