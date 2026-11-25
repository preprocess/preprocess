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
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from "@preprocess/ui/components/sidebar";
import { FileIcon, Moon, Search, Sun } from "@preprocess/ui/lib/icons";
import { ShapeProvider } from "@preprocess/ui/lib/shape-context";
import { SurfaceProvider } from "@preprocess/ui/lib/surface-context";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
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

// The docs wear the app's shell: the same inset sidebar, search row, command
// menu and theme switch, fed by Fumadocs' page tree and search index.

// Page tree names reach the client as spans of escaped HTML; the command
// menu and card labels want their text.
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

// API operation names end with their HTTP method; the row shows it apart from
// the label so a long label truncates instead of wrapping.
function rowLabel(node: ReactNode) {
  const text = textOf(node).replace(/\s+/g, " ").trim();
  const match = /^(.*) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.exec(text);
  return match ? { label: match[1], method: match[2] } : { label: text };
}

// The menu row truncates only a leading string child, so the label goes in
// as text and the method follows it.
function rowContent(node: ReactNode): ReactNode[] {
  const { label, method } = rowLabel(node);
  if (!method) return [label];
  return [
    label,
    <span
      className={cn(
        typeClass("caption"),
        "ml-auto shrink-0 font-mono text-muted-foreground",
      )}
      key="method"
    >
      {method}
    </span>,
  ];
}

function contains(node: PageTree.Node, url: string): boolean {
  if (node.type === "page") return node.url === url;
  if (node.type === "folder")
    return (
      node.index?.url === url || node.children.some((c) => contains(c, url))
    );
  return false;
}

// Every docs page is the splat route; links go through the router so the
// sidebar's highlight can measure them.
function PageLink({ url, ...props }: { url: string } & ComponentProps<"a">) {
  return <Link {...props} params={{ _splat: url.slice(1) }} to="/$" />;
}

function PageRow({
  item,
  pathname,
}: {
  item: PageTree.Item;
  pathname: string;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={item.url === pathname}
        render={<PageLink url={item.url} />}
      >
        {rowContent(item.name)}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// A folder inside a section (an API tag): a row that opens its pages.
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
  const pages = folder.children.filter(
    (child): child is PageTree.Item => child.type === "page",
  );
  return (
    <SidebarMenuItem>
      <SidebarMenuButton aria-expanded={open} onClick={() => setOpen(!open)}>
        {textOf(folder.name)}
      </SidebarMenuButton>
      <SidebarMenuSub open={open}>
        {pages.map((page) => (
          <SidebarMenuSubItem key={page.url}>
            <SidebarMenuSubButton
              isActive={page.url === pathname}
              render={<PageLink url={page.url} />}
            >
              {rowContent(page.name)}
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    </SidebarMenuItem>
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
    <SidebarMenu className="gap-1">
      {nodes.map((node, index) =>
        node.type === "page" ? (
          <PageRow item={node} key={node.url} pathname={pathname} />
        ) : node.type === "folder" ? (
          <FolderRow folder={node} key={index} pathname={pathname} />
        ) : null,
      )}
    </SidebarMenu>
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
      return tree.children
        .filter((node): node is PageTree.Item => node.type === "page")
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
        <CommandMenuInput placeholder="Search" />
        <CommandMenuList>
          <CommandMenuEmpty>No results found</CommandMenuEmpty>
        </CommandMenuList>
        <CommandMenuFooter />
      </CommandMenu>
    </CommandMenuDialog>
  );
}

function ThemeRow() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          icon={dark ? Sun : Moon}
          onClick={() => setTheme(dark ? "light" : "dark")}
        >
          {dark ? "Switch to light mode" : "Switch to dark mode"}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function DocsSidebar({ tree }: { tree: PageTree.Root }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
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

  const pages = tree.children.filter((node) => node.type !== "folder");
  const sections = tree.children.filter(
    (node): node is PageTree.Folder => node.type === "folder",
  );

  return (
    <ShapeProvider defaultShape="rounded">
      <Sidebar rail={false} variant="inset">
        <SidebarHeader>
          <PageLink className="flex h-9 items-center gap-2 px-2" url="/">
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
              className={typeClass("body")}
              style={{ fontVariationSettings: fontWeights.semibold }}
            >
              Preprocess
            </span>
          </PageLink>
          <SidebarMenu aria-label="Search">
            <SidebarMenuItem>
              <SidebarMenuButton
                icon={Search}
                onClick={() => setSearchOpen(true)}
              >
                Search
              </SidebarMenuButton>
              <SidebarMenuBadge>{shortcut}</SidebarMenuBadge>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <Rows nodes={pages} pathname={pathname} />
          </SidebarGroup>
          {sections.map((section, index) => (
            <SidebarGroup key={index}>
              <SidebarGroupLabel>{textOf(section.name)}</SidebarGroupLabel>
              <Rows nodes={section.children} pathname={pathname} />
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <ThemeRow />
        </SidebarFooter>
      </Sidebar>
      <DocsSearch onOpenChange={setSearchOpen} open={searchOpen} tree={tree} />
    </ShapeProvider>
  );
}

export function DocsShell({
  tree,
  children,
}: {
  tree: PageTree.Root;
  children: ReactNode;
}) {
  return (
    <SidebarProvider className="h-svh" persist={false} shortcut={null}>
      <DocsSidebar tree={tree} />
      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 px-1.5">
          <SidebarTrigger />
        </header>
        <SurfaceProvider value={2}>
          <ScrollArea
            className="min-h-0 flex-1"
            viewportClassName="scroll-fade"
          >
            {children}
          </ScrollArea>
        </SurfaceProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
