import { Button } from "@preprocess/ui/components/button";
import {
  CommandMenu,
  CommandMenuDialog,
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuInput,
  CommandMenuList,
  isMacPlatform,
  type CommandMenuItemData,
} from "@preprocess/ui/components/command-menu";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@preprocess/ui/components/sheet";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  BookOpen,
  ChevronRight,
  Code,
  FileIcon,
  Moon,
  Search,
  SidebarLeftIcon,
  Sun,
} from "@preprocess/ui/lib/icons";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import type { TOCItemType } from "fumadocs-core/toc";
import { TOCProvider } from "fumadocs-ui/components/toc";
import { cn } from "@preprocess/ui/lib/utils";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import type * as PageTree from "fumadocs-core/page-tree";
import { useDocsSearch } from "fumadocs-core/search/client";
import { useTheme } from "next-themes";
import {
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { OnThisPagePopover } from "./docs-toc";

// The docs read as a document: a plain section list on the left, a top bar
// with search and the way into the app, and the page in a centered column.
// Fumadocs supplies the page tree and the search index.

// Page tree names reach the client as spans of escaped HTML; labels, crumbs
// and the command menu want their text.
export function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (
    !isValidElement<{
      children?: ReactNode;
      dangerouslySetInnerHTML?: { __html: string };
    }>(node)
  )
    return "";
  const html = node.props.dangerouslySetInnerHTML?.__html;
  if (html === undefined) return textOf(node.props.children);
  return html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
}

// API operation names end with their HTTP method; rows show it apart from
// the label so a long label truncates instead of wrapping.
function rowLabel(node: ReactNode) {
  const text = textOf(node).replace(/\s+/g, " ").trim();
  const match = /^(.*) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.exec(text);
  return match ? { label: match[1], method: match[2] } : { label: text };
}

export function contains(node: PageTree.Node, url: string): boolean {
  if (node.type === "page") return node.url === url;
  if (node.type === "folder")
    return (
      node.index?.url === url || node.children.some((c) => contains(c, url))
    );
  return false;
}

export function firstPage(node: PageTree.Folder): string | undefined {
  if (node.index) return node.index.url;
  for (const child of node.children) {
    if (child.type === "page") return child.url;
    if (child.type === "folder") {
      const url = firstPage(child);
      if (url) return url;
    }
  }
  return undefined;
}

// Every docs page is the splat route; links go through the router.
export function PageLink({
  url,
  ...props
}: { url: string } & ComponentProps<"a">) {
  return <Link {...props} params={{ _splat: url.slice(1) }} to="/$" />;
}

const rowClass = (active: boolean) =>
  cn(
    typeClass("subtitle"),
    "flex h-9 w-full min-w-0 items-center gap-2 rounded-full px-3 text-left transition-colors",
    active
      ? "bg-hover text-foreground"
      : "text-muted-foreground hover:bg-hover hover:text-foreground",
  );

const weight = (active: boolean) => ({
  fontVariationSettings: active ? fontWeights.semibold : fontWeights.normal,
});

function PageRow({
  item,
  pathname,
}: {
  item: PageTree.Item;
  pathname: string;
}) {
  const active = item.url === pathname;
  const { label, method } = rowLabel(item.name);
  return (
    <li>
      <PageLink
        className={rowClass(active)}
        style={weight(active)}
        url={item.url}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {method ? (
          <span
            className={cn(
              typeClass("micro"),
              "shrink-0 font-mono text-muted-foreground",
            )}
          >
            {method}
          </span>
        ) : null}
      </PageLink>
    </li>
  );
}

// A folder (an API tag): a row whose chevron opens its pages in place.
function FolderRow({
  folder,
  pathname,
}: {
  folder: PageTree.Folder;
  pathname: string;
}) {
  const current = contains(folder, pathname);
  const [open, setOpen] = useState(current);
  useEffect(() => {
    if (current) setOpen(true);
  }, [current]);
  return (
    <li>
      <button
        aria-expanded={open}
        className={rowClass(false)}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate">{textOf(folder.name)}</span>
        <ChevronRight
          className={cn(
            "shrink-0 transition-transform duration-150",
            open && "rotate-90",
          )}
          size={14}
        />
      </button>
      {open ? (
        <ul className="my-1 ml-4 flex flex-col gap-0.5 border-l border-border pl-2">
          {folder.children.map((child, index) =>
            child.type === "page" ? (
              <PageRow item={child} key={child.url} pathname={pathname} />
            ) : child.type === "folder" ? (
              <FolderRow folder={child} key={index} pathname={pathname} />
            ) : null,
          )}
        </ul>
      ) : null}
    </li>
  );
}

function Rows({
  nodes,
  pathname,
}: {
  nodes: PageTree.Node[];
  pathname: string;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((node, index) =>
        node.type === "page" ? (
          <PageRow item={node} key={node.url} pathname={pathname} />
        ) : node.type === "folder" ? (
          <FolderRow folder={node} key={index} pathname={pathname} />
        ) : null,
      )}
    </ul>
  );
}

// The two halves of the docs: prose guides at the top level of the tree,
// and the reference folders (the API) beneath them.
export function splitTree(tree: PageTree.Root) {
  return {
    guides: tree.children.filter((node) => node.type !== "folder"),
    reference: tree.children.filter(
      (node): node is PageTree.Folder => node.type === "folder",
    ),
  };
}

// The sidebar's contents: beside the page on wide screens, in a sheet below
// lg.
function SidebarBody({ tree }: { tree: PageTree.Root }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { guides, reference } = splitTree(tree);
  const inReference = reference.some((folder) => contains(folder, pathname));
  const referenceUrl = reference[0] ? firstPage(reference[0]) : undefined;

  return (
    <>
      <PageLink className="flex h-14 shrink-0 items-center gap-2 px-6" url="/">
        <img
          alt=""
          className="size-5 dark:hidden"
          src="/brand/favicon-light.svg"
        />
        <img
          alt=""
          className="hidden size-5 dark:block"
          src="/brand/favicon-dark.svg"
        />
        <span
          className={cn(typeClass("title"), "text-foreground")}
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          Preprocess
        </span>
        <span
          className={cn(
            typeClass("caption"),
            "rounded-full border border-border px-2 text-muted-foreground",
          )}
        >
          Docs
        </span>
      </PageLink>
      <nav aria-label="Sections" className="flex flex-col gap-0.5 px-3 pt-4">
        <PageLink
          className={rowClass(!inReference)}
          style={weight(!inReference)}
          url="/"
        >
          <BookOpen className="shrink-0" size={16} />
          Guides
        </PageLink>
        {referenceUrl ? (
          <PageLink
            className={rowClass(inReference)}
            style={weight(inReference)}
            url={referenceUrl}
          >
            <Code className="shrink-0" size={16} />
            Reference
          </PageLink>
        ) : null}
      </nav>
      <div className="mx-6 my-4 border-t border-border" />
      <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
        <nav
          aria-label={inReference ? "Reference" : "Guides"}
          className="w-72 px-3 pb-6"
        >
          {inReference ? (
            reference.map((folder, index) => (
              <Rows key={index} nodes={folder.children} pathname={pathname} />
            ))
          ) : (
            <Rows nodes={guides} pathname={pathname} />
          )}
        </nav>
      </ScrollArea>
    </>
  );
}

function MobileMenu({ tree }: { tree: PageTree.Root }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger
        render={
          <Button
            aria-label="Open navigation"
            className="lg:hidden"
            size="icon"
            variant="ghost"
          />
        }
      >
        <SidebarLeftIcon size={16} />
      </SheetTrigger>
      <SheetContent className="w-72 gap-0 bg-background p-0" side="left">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarBody tree={tree} />
      </SheetContent>
    </Sheet>
  );
}

function useShortcutLabel() {
  const [label, setLabel] = useState("⌘K");
  useEffect(() => {
    if (!isMacPlatform()) setLabel("Ctrl K");
  }, []);
  return label;
}

function DocsSearch({
  open,
  onOpenChange,
  tree,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: PageTree.Root;
}) {
  const router = useRouter();
  const { search, setSearch, query } = useDocsSearch({ type: "fetch" });
  const items = useMemo((): CommandMenuItemData[] => {
    const go = (url: string) => () => {
      void router.navigate({ href: url });
    };
    if (search === "" || query.data === "empty")
      return splitTree(tree)
        .guides.filter((node): node is PageTree.Item => node.type === "page")
        .map((page) => ({
          value: page.url,
          label: rowLabel(page.name).label,
          icon: FileIcon,
          onSelect: go(page.url),
        }));
    return (query.data ?? []).map((result) => ({
      value: result.id,
      label: result.content,
      icon: result.type === "page" ? FileIcon : undefined,
      onSelect: go(result.url),
    }));
  }, [query.data, router, search, tree]);

  return (
    <CommandMenuDialog
      description="Search the docs."
      onOpenChange={onOpenChange}
      open={open}
      title="Search"
    >
      <CommandMenu
        filter={() => true}
        items={items}
        onQueryChange={setSearch}
        query={search}
      >
        <CommandMenuInput placeholder="Search documentation" />
        <CommandMenuList>
          <CommandMenuEmpty>No results found</CommandMenuEmpty>
        </CommandMenuList>
        <CommandMenuFooter />
      </CommandMenu>
    </CommandMenuDialog>
  );
}

function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  const Icon = dark ? Sun : Moon;
  return (
    <Button
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      size="icon"
      variant="ghost"
    >
      <Icon size={16} />
    </Button>
  );
}

function TopBar({ tree, appUrl }: { tree: PageTree.Root; appUrl: string }) {
  const shortcut = useShortcutLabel();
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 lg:px-6">
      <MobileMenu tree={tree} />
      <button
        className={cn(
          typeClass("body"),
          "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-card px-3 text-muted-foreground transition-colors hover:text-foreground sm:max-w-xs",
        )}
        onClick={() => setSearchOpen(true)}
        type="button"
      >
        <Search className="shrink-0" size={16} />
        <span className="min-w-0 flex-1 truncate text-left">
          Search documentation
        </span>
        <kbd className={cn(typeClass("micro"), "hidden font-sans sm:inline")}>
          {shortcut}
        </kbd>
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <ThemeButton />
        <Button render={<a href={appUrl} />} trailingIcon={ChevronRight}>
          Open the app
        </Button>
      </div>
      <DocsSearch onOpenChange={setSearchOpen} open={searchOpen} tree={tree} />
    </header>
  );
}

export function DocsShell({
  tree,
  appUrl,
  toc = [],
  children,
}: {
  tree: PageTree.Root;
  appUrl: string;
  toc?: TOCItemType[];
  children: ReactNode;
}) {
  return (
    <TOCProvider toc={toc}>
      <div className="flex h-svh bg-background">
        <aside className="hidden w-72 shrink-0 flex-col border-r border-border lg:flex">
          <SidebarBody tree={tree} />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <TopBar appUrl={appUrl} tree={tree} />
          {toc.length > 0 ? <OnThisPagePopover /> : null}
          <ScrollArea
            className="min-h-0 flex-1"
            viewportClassName="scroll-fade"
          >
            {children}
          </ScrollArea>
        </main>
      </div>
    </TOCProvider>
  );
}
