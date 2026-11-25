import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { ChevronLeftIcon, ChevronRight } from "@preprocess/ui/lib/icons";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";
import * as PageTree from "fumadocs-core/page-tree";
import { useTOCItems } from "fumadocs-ui/components/toc";
import type { ReactNode } from "react";

import { OnThisPage } from "./docs-toc";
import { crumbsFor, PageLink, rowLabel } from "./page-tree";
import { Wordmark } from "./wordmark";

// Below lg the breadcrumb is one eyebrow line over the title: the page's
// ancestors, or the section itself on its landing page.
function Eyebrow({ tree, url }: { tree: PageTree.Root; url: string }) {
  const crumbs = crumbsFor(tree, url);
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

function Neighbours({ tree, url }: { tree: PageTree.Root; url: string }) {
  const { previous, next } = PageTree.findNeighbour(tree, url);
  if (!previous && !next) return null;
  const card = (page: PageTree.Item, label: string, forward: boolean) => (
    <PageLink
      className={cn(
        "flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-hover",
        forward ? "sm:col-start-2" : "flex-row-reverse text-right",
      )}
      url={page.url}
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
          {page.url === "/" ? "Overview" : rowLabel(page.name).label}
        </span>
      </span>
      {forward ? (
        <ChevronRight className="shrink-0 text-muted-foreground" size={16} />
      ) : (
        <ChevronLeftIcon className="shrink-0 text-muted-foreground" size={16} />
      )}
    </PageLink>
  );
  return (
    <nav aria-label="Next steps" className="grid gap-3 pt-14 sm:grid-cols-2">
      {previous ? card(previous, "Previous", false) : null}
      {next ? card(next, "Next", true) : null}
    </nav>
  );
}

function PageFooter({ home }: { home: boolean }) {
  const link = "transition-colors hover:text-foreground";
  return (
    <footer
      className={cn(
        typeClass("caption"),
        home ? "mt-18" : "mt-12",
        "flex items-center justify-between gap-4 border-t border-border py-6 text-muted-foreground",
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

// One docs page as a document: a large title and a lead paragraph, the body
// in a reading column with the table of contents to its right, and the pages
// either side of it at the foot. The home page is one wider column under the
// mark; API pages are wide enough for their examples column.
export function DocsArticle({
  title,
  description,
  layout = "guide",
  tree,
  url,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  layout?: "home" | "guide" | "api";
  tree: PageTree.Root;
  url: string;
  children: ReactNode;
}) {
  const toc = useTOCItems();
  const rail = layout === "guide" && toc.length > 0;
  return (
    <div className="docs-article @container">
      <div
        className={cn(
          "mx-auto flex w-full justify-center gap-16 px-5 pb-8 lg:pb-24",
          layout === "home" ? "pt-4 lg:px-12 lg:pt-10" : "pt-5 lg:pt-6",
          layout === "api" ? "lg:px-10" : "lg:px-12",
        )}
      >
        <article
          className={cn(
            "w-full min-w-0",
            layout === "home"
              ? "max-w-[760px]"
              : layout === "api"
                ? "max-w-[1048px]"
                : "max-w-[680px]",
          )}
        >
          {layout === "home" ? (
            <Wordmark className="mb-2 hidden size-9 lg:block" markOnly />
          ) : (
            <Eyebrow tree={tree} url={url} />
          )}
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
          <div
            className={cn(
              "typeset docs-prose",
              layout === "home" ? "mt-7" : "mt-8",
            )}
          >
            {children}
          </div>
          {layout === "home" ? null : <Neighbours tree={tree} url={url} />}
          <PageFooter home={layout === "home"} />
        </article>
        {rail ? (
          <aside className="docs-app-step sticky top-6 mt-2 hidden max-h-[calc(100svh-8rem)] w-[200px] shrink-0 self-start xl:flex">
            <OnThisPage />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
