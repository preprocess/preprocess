import {
  Card,
  CardDescription,
  CardGroup,
  CardHeader,
  CardTitle,
} from "@preprocess/ui/components/card";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";
import { useRouter } from "@tanstack/react-router";
import * as PageTree from "fumadocs-core/page-tree";
import {
  AnchorProvider,
  TOCItem,
  useActiveAnchors,
  type TOCItemType,
} from "fumadocs-core/toc";
import type { ReactNode } from "react";

import { textOf } from "./docs-shell";

function OnThisPage({ toc }: { toc: TOCItemType[] }) {
  const active = useActiveAnchors();
  return (
    <nav aria-label="On this page">
      <p
        className={cn(typeClass("caption"), "text-muted-foreground")}
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        On this page
      </p>
      <ul className="mt-2 flex flex-col gap-1 border-l border-border">
        {toc.map((item) => (
          <li key={item.url}>
            <TOCItem
              className={cn(
                typeClass("caption"),
                "-ml-px block border-l py-1 transition-colors",
                item.depth > 2 ? "pl-6" : "pl-3",
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

function Neighbours({ tree, url }: { tree: PageTree.Root; url: string }) {
  const router = useRouter();
  const { previous, next } = PageTree.findNeighbour(tree, url);
  const pages = [previous, next].filter(
    (page): page is PageTree.Item => page !== undefined,
  );
  if (pages.length === 0) return null;
  return (
    <CardGroup border="outlined" className="mt-12" columns={2} separated>
      {pages.map((page) => (
        <Card
          className={page === next && !previous ? "col-start-2" : undefined}
          key={page.url}
          label={textOf(page.name)}
          onClick={() => void router.navigate({ href: page.url })}
        >
          <CardHeader>
            <CardTitle>{textOf(page.name)}</CardTitle>
            {page.description ? (
              <CardDescription>{page.description}</CardDescription>
            ) : null}
          </CardHeader>
        </Card>
      ))}
    </CardGroup>
  );
}

// One docs page: the title and description on the app's type roles, the body
// in Fluid's typeset, the table of contents beside it, and the pages either
// side of it at the foot.
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
      <div className="mx-auto flex w-full max-w-5xl justify-center gap-12 px-6 pt-4 pb-16 md:px-12">
        <article className="min-w-0 max-w-2xl flex-1">
          <header className="typeset">
            <h1>{title}</h1>
            {description ? (
              <p className={typeClass("subtitle")}>{description}</p>
            ) : null}
          </header>
          <div className="typeset mt-8">{children}</div>
          {url === "/" ? null : <Neighbours tree={tree} url={url} />}
        </article>
        {toc.length > 0 ? (
          <aside className="sticky top-4 hidden w-52 shrink-0 self-start xl:block">
            <OnThisPage toc={toc} />
          </aside>
        ) : null}
      </div>
    </AnchorProvider>
  );
}
