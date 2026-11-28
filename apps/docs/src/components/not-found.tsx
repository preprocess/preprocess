import { Button } from "@preprocess/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@preprocess/ui/components/empty";
import type * as PageTree from "fumadocs-core/page-tree";
import { useFumadocsLoader } from "fumadocs-core/source/client";

import { DocsShell } from "./docs-shell";
import { PageLink } from "./page-tree";

function Missing() {
  return (
    <Empty className="min-h-[60svh]">
      <EmptyHeader>
        <EmptyTitle>Page not found</EmptyTitle>
        <EmptyDescription>
          There is no docs page at this address.
        </EmptyDescription>
      </EmptyHeader>
      <Button render={<PageLink url="/" />} variant="secondary">
        Back to the docs
      </Button>
    </Empty>
  );
}

// A missing page inside the docs shell, so the sidebar and search still
// lead somewhere. Without the tree (a router-level miss) it stands alone.
function ShellNotFound({
  data,
}: {
  data: { apiUrl: string; pageTree: object; statusUrl: string | null };
}) {
  const { apiUrl, pageTree, statusUrl } = useFumadocsLoader(data) as {
    apiUrl: string;
    pageTree: PageTree.Root;
    statusUrl: string | null;
  };
  return (
    <DocsShell
      appUrl={new URL(apiUrl).origin}
      statusUrl={statusUrl}
      tree={pageTree}
    >
      <Missing />
    </DocsShell>
  );
}

export function NotFound({ data }: { data?: unknown }) {
  if (
    data &&
    typeof data === "object" &&
    "pageTree" in data &&
    "apiUrl" in data
  )
    return (
      <ShellNotFound
        data={
          data as {
            apiUrl: string;
            pageTree: object;
            statusUrl: string | null;
          }
        }
      />
    );
  return (
    <main className="flex h-svh flex-col items-center justify-center">
      <Missing />
    </main>
  );
}
