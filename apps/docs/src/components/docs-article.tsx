import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@preprocess/ui/components/breadcrumb";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { ChevronLeftIcon, ChevronRight } from "@preprocess/ui/lib/icons";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";
import * as PageTree from "fumadocs-core/page-tree";
import {
  AnchorProvider,
  TOCItem,
  useActiveAnchors,
  type TOCItemType,
} from "fumadocs-core/toc";
import { Fragment, type ReactNode } from "react";

import { contains, firstPage, PageLink, splitTree, textOf } from "./docs-shell";

function OnThisPage({ toc }: { toc: TOCItemType[] }) {
  const active = useActiveAnchors();
  return (
    <nav aria-label="On this page">
      <p
        className={cn(typeClass("body"), "text-foreground")}
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        On this page
      </p>
      <ul className="mt-3 flex flex-col gap-1 border-l border-border">
        {toc.map((item) => (
          <li key={item.url}>
            <TOCItem
              className={cn(
                typeClass("body"),
                "-ml-px block border-l py-1 transition-colors",
                item.depth > 2 ? "pl-7" : "pl-4",
                active.includes(item.url.slice(1))
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              href={item.url}
            >
              {item.title}
            </TOCItem>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Where the page sits: Guides, or Reference and the folders above it.
function Crumbs({ tree, url }: { tree: PageTree.Root; url: string }) {
  const { reference } = splitTree(tree);
  const root = reference.find((folder) => contains(folder, url));
  const crumbs: { label: string; url?: string }[] = [];
  if (!root) crumbs.push({ label: "Guides", url: "/" });
  else {
    crumbs.push({ label: "Reference", url: firstPage(root) });
    let folder: PageTree.Folder | undefined = root;
    while (folder) {
      const next: PageTree.Folder | undefined = folder.children.find(
        (child): child is PageTree.Folder =>
          child.type === "folder" && contains(child, url),
      );
      if (next) crumbs.push({ label: textOf(next.name) });
      folder = next;
    }
  }
  return (
    <Breadcrumb>
      <BreadcrumbList className={typeClass("body")}>
        {crumbs.map((crumb, index) => (
          <Fragment key={index}>
            {index > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              {crumb.url ? (
                <BreadcrumbLink render={<PageLink url={crumb.url} />}>
                  {crumb.label}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="text-muted-foreground">
                  {crumb.label}
                </BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function Neighbours({ tree, url }: { tree: PageTree.Root; url: string }) {
  const { previous, next } = PageTree.findNeighbour(tree, url);
  if (!previous && !next) return null;
  const card = (page: PageTree.Item, label: string, forward: boolean) => (
    <PageLink
      className={cn(
        "flex items-center gap-4 rounded-2xl border border-border px-5 py-4 transition-colors hover:bg-hover",
        forward ? "sm:col-start-2" : "flex-row-reverse text-right",
      )}
      url={page.url}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn(typeClass("caption"), "text-muted-foreground")}>
          {label}
        </span>
        <span
          className={cn(typeClass("subtitle"), "truncate text-foreground")}
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {textOf(page.name).replace(/ (GET|POST|PUT|PATCH|DELETE)$/, "")}
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
    <nav
      aria-label="Next steps"
      className="mt-16 grid gap-3 border-t border-border pt-8 sm:grid-cols-2"
    >
      {previous ? card(previous, "Previous", false) : null}
      {next ? card(next, "Next", true) : null}
    </nav>
  );
}

// One docs page as a document: crumbs, a large title and a lead paragraph,
// the body in a centered reading column, the table of contents to its right
// and the pages either side of it at the foot.
export function DocsArticle({
  title,
  description,
  toc = [],
  tree,
  url,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  toc?: TOCItemType[];
  tree: PageTree.Root;
  url: string;
  children: ReactNode;
}) {
  return (
    <AnchorProvider toc={toc}>
      <div className="mx-auto flex w-full max-w-7xl justify-center gap-16 px-6 pt-12 pb-24 md:px-12">
        <article className="min-w-0 max-w-4xl flex-1">
          <Crumbs tree={tree} url={url} />
          <h1
            className={cn(typeClass("display"), "mt-6 text-foreground")}
            style={{ fontVariationSettings: fontWeights.bold }}
          >
            {title}
          </h1>
          {description ? (
            <p
              className={cn(
                typeClass("title"),
                "mt-4 leading-relaxed text-muted-foreground",
              )}
            >
              {description}
            </p>
          ) : null}
          <div className="typeset docs-prose mt-10">{children}</div>
          {url === "/" ? null : <Neighbours tree={tree} url={url} />}
        </article>
        {toc.length > 0 ? (
          <aside className="sticky top-12 hidden w-56 shrink-0 self-start xl:block">
            <OnThisPage toc={toc} />
          </aside>
        ) : null}
      </div>
    </AnchorProvider>
  );
}
