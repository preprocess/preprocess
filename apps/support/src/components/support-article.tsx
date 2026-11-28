import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { ChevronLeftIcon, ChevronRight } from "@preprocess/ui/lib/icons";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";
import { useTOCItems } from "fumadocs-ui/components/toc";
import type { ReactNode } from "react";

import type { HelpArticle, HelpCenter } from "@/lib/help";

import { OnThisPage } from "./article-toc";
import { crumbsFor, HelpLink } from "./help-link";

// The docs' article (apps/docs/src/components/docs-article.tsx) as it is: a
// large title and a lead paragraph, the body in a reading column with the
// table of contents to its right, and the articles either side of it in its
// category at the foot.

// Below lg the breadcrumb is one eyebrow line over the title: the page's
// ancestors.
function Eyebrow({ help, url }: { help: HelpCenter; url: string }) {
  const crumbs = crumbsFor(help, url);
  const ancestors = crumbs.length > 1 ? crumbs.slice(0, -1) : crumbs;
  return (
    <p
      className={cn(
        typeClass("caption"),
        "mb-2 text-muted-foreground lg:hidden",
      )}
      style={{ fontVariationSettings: fontWeights.medium }}
    >
      {ancestors.map((crumb) => crumb.label).join(" / ")}
    </p>
  );
}

function Neighbours({ help, url }: { help: HelpCenter; url: string }) {
  const articles = help.categories.find((category) =>
    category.articles.some((article) => article.url === url),
  )?.articles;
  if (!articles) return null;
  const at = articles.findIndex((article) => article.url === url);
  const previous = articles[at - 1];
  const next = articles[at + 1];
  if (!previous && !next) return null;
  const card = (article: HelpArticle, label: string, forward: boolean) => (
    <HelpLink
      className={cn(
        "flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-hover",
        forward ? "sm:col-start-2" : "flex-row-reverse text-right",
      )}
      url={article.url}
    >
      <span
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          forward ? "items-end text-right" : "items-start text-left",
        )}
      >
        <span className={cn(typeClass("caption"), "text-muted-foreground")}>
          {label}
        </span>
        <span
          className={cn(
            typeClass("subtitle"),
            "max-w-full truncate text-foreground",
          )}
          style={{ fontVariationSettings: fontWeights.medium }}
        >
          {article.title}
        </span>
      </span>
      {forward ? (
        <ChevronRight className="shrink-0 text-muted-foreground" size={16} />
      ) : (
        <ChevronLeftIcon className="shrink-0 text-muted-foreground" size={16} />
      )}
    </HelpLink>
  );
  return (
    <nav aria-label="Next steps" className="grid gap-3 pt-14 sm:grid-cols-2">
      {previous ? card(previous, "Previous", false) : null}
      {next ? card(next, "Next", true) : null}
    </nav>
  );
}

function PageFooter() {
  const link = "transition-colors hover:text-foreground";
  return (
    <footer
      className={cn(
        typeClass("caption"),
        "mt-12 flex items-center justify-between gap-4 border-t border-border py-6 text-muted-foreground",
      )}
    >
      <span>Preprocess, Inc.</span>
      <span className="flex items-center gap-4">
        <a className={link} href="https://www.preprocess.com">
          preprocess.com
        </a>
        <a className={link} href="https://github.com/preprocess">
          GitHub
        </a>
      </span>
    </footer>
  );
}

export function SupportArticle({
  title,
  description,
  help,
  url,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  help: HelpCenter;
  url: string;
  children: ReactNode;
}) {
  const toc = useTOCItems();
  return (
    <div className="docs-article @container">
      <div className="mx-auto flex w-full justify-center gap-16 px-5 pt-5 pb-8 lg:px-12 lg:pt-6 lg:pb-24">
        <article className="w-full max-w-[680px] min-w-0">
          <Eyebrow help={help} url={url} />
          <h1
            className={cn(
              typeClass("display"),
              "tracking-[-0.03em] text-foreground",
            )}
            data-page-title
            style={{ fontVariationSettings: fontWeights.medium }}
          >
            {title}
          </h1>
          {description ? (
            <p className={cn(typeClass("title"), "mt-3 text-muted-foreground")}>
              {description}
            </p>
          ) : null}
          <div className="typeset docs-prose mt-8">{children}</div>
          <Neighbours help={help} url={url} />
          <PageFooter />
        </article>
        {toc.length > 0 ? (
          <aside className="docs-app-step sticky top-6 mt-2 hidden max-h-[calc(100svh-8rem)] w-[200px] shrink-0 self-start xl:flex">
            <OnThisPage />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
