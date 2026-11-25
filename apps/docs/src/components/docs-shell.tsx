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
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@preprocess/ui/components/sheet";
import {
  Sidebar,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "@preprocess/ui/components/sidebar";
import {
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@preprocess/ui/components/sidebar-menu";
import { TabItem, Tabs, TabsList } from "@preprocess/ui/components/tabs";
import { useTouchPrimary } from "@preprocess/ui/hooks/use-touch-primary";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  ArrowUpRight,
  BookOpen,
  Braces,
  Check,
  ChevronRight,
  Code,
  Copy,
  FileText,
  Hash,
  Home,
  Menu,
  Monitor,
  Moon,
  Plug,
  Search,
  Sun,
  Terminal,
  X,
} from "@preprocess/ui/lib/icons";
import { ShapeProvider } from "@preprocess/ui/lib/shape-context";
import { SurfaceProvider } from "@preprocess/ui/lib/surface-context";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";
import { useRouter, useRouterState } from "@tanstack/react-router";
import type { TOCItemType } from "fumadocs-core/toc";
import type * as PageTree from "fumadocs-core/page-tree";
import { useDocsSearch } from "fumadocs-core/search/client";
import { TOCProvider } from "fumadocs-ui/components/toc";
import { useTheme } from "next-themes";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import {
  contains,
  crumbsFor,
  firstPage,
  folderPages,
  guideLabel,
  PageLink,
  rowLabel,
  splitTree,
  textOf,
} from "./page-tree";
import { MobileContents, OnThisPagePopover } from "./docs-toc";
import { Wordmark } from "./wordmark";

// The docs use the app's own shell: a sidebar on the surface-1 chrome and the
// page on an inset surface-2 panel. Fumadocs supplies the page tree and the
// search index.

const guideIcons: Record<string, typeof Home> = {
  "/": Home,
  "/sdk": Code,
  "/cli": Terminal,
  "/mcp": Plug,
};

// HTTP methods take the status hues, the docs' only use of them.
const methodHue: Record<string, string> = {
  GET: "var(--success)",
  POST: "var(--info)",
  PUT: "var(--warning)",
  PATCH: "var(--warning)",
  DELETE: "var(--destructive)",
};

const methodLabel = (method: string) => (method === "DELETE" ? "DEL" : method);

// The method badge is a fixed 2.5rem at the row's right inset; the label
// truncates a step before it.
const methodGutter = {
  "--row-gutter": "3.5rem",
  "--row-gutter-hover": "3.5rem",
} as CSSProperties;

// An API operation's row: its label, with the HTTP method as the row's badge.
function PageRow({
  item,
  pathname,
}: {
  item: PageTree.Item;
  pathname: string;
}) {
  const { label, method } = rowLabel(item.name);
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        isActive={item.url === pathname}
        render={<PageLink url={item.url} />}
        style={method ? methodGutter : undefined}
      >
        {label}
      </SidebarMenuSubButton>
      {method ? (
        <SidebarMenuBadge
          className={cn(
            typeClass("micro", "compact"),
            "top-1 w-10 justify-end font-mono",
          )}
          style={{
            color: methodHue[method],
            fontVariationSettings: fontWeights.medium,
          }}
        >
          {methodLabel(method)}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuSubItem>
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
    <SidebarMenuItem>
      <SidebarMenuButton aria-expanded={open} onClick={() => setOpen(!open)}>
        {textOf(folder.name)}
      </SidebarMenuButton>
      <SidebarMenuBadge>
        <ChevronRight
          className={cn(
            "transition-transform duration-150",
            open && "rotate-90",
          )}
          size={14}
        />
      </SidebarMenuBadge>
      <SidebarMenuSub open={open}>
        {folderPages(folder).map((page) => (
          <PageRow item={page} key={page.url} pathname={pathname} />
        ))}
      </SidebarMenuSub>
    </SidebarMenuItem>
  );
}

function GuideRows({
  nodes,
  pathname,
}: {
  nodes: PageTree.Node[];
  pathname: string;
}) {
  return (
    <SidebarMenu aria-label="Guides" className="gap-0.5">
      {nodes.map((node) =>
        node.type === "page" ? (
          <SidebarMenuItem key={node.url}>
            <SidebarMenuButton
              icon={guideIcons[node.url] ?? FileText}
              isActive={node.url === pathname}
              render={<PageLink url={node.url} />}
            >
              {guideLabel(node)}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null,
      )}
    </SidebarMenu>
  );
}

function ReferenceRows({
  folder,
  pathname,
}: {
  folder: PageTree.Folder;
  pathname: string;
}) {
  return (
    <>
      {folder.index ? (
        <SidebarMenu aria-label="Reference" className="gap-0.5">
          <SidebarMenuItem>
            <SidebarMenuButton
              icon={Braces}
              isActive={folder.index.url === pathname}
              render={<PageLink url={folder.index.url} />}
            >
              Introduction
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      ) : null}
      <SidebarGroup className="px-0 pt-4">
        <SidebarGroupLabel>Endpoints</SidebarGroupLabel>
        <SidebarMenu aria-label="Endpoints" className="gap-0.5">
          {folder.children.map((node, index) =>
            node.type === "folder" ? (
              <FolderRow folder={node} key={index} pathname={pathname} />
            ) : null,
          )}
        </SidebarMenu>
      </SidebarGroup>
    </>
  );
}

function useShortcutLabel() {
  const [label, setLabel] = useState("⌘K");
  useEffect(() => {
    if (!isMacPlatform()) setLabel("Ctrl K");
  }, []);
  return label;
}

function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  const shortcut = useShortcutLabel();
  return (
    <button
      className={cn(
        typeClass("body"),
        "flex h-9 w-full items-center gap-2 rounded-[10px] bg-surface-2 pr-1.5 pl-2.5 text-muted-foreground shadow-surface-2 transition-colors hover:text-foreground",
      )}
      onClick={onOpen}
      type="button"
    >
      <Search className="shrink-0" size={16} />
      <span className="min-w-0 flex-1 truncate text-left">
        Search documentation
      </span>
      <kbd
        className={cn(
          typeClass("micro"),
          "flex h-5 items-center rounded-md bg-surface-1 px-1.5 font-sans text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]",
        )}
      >
        {shortcut}
      </kbd>
    </button>
  );
}

// Guides or Reference: a segmented switch whose segments are links.
function SectionSwitch({
  inReference,
  referenceUrl,
}: {
  inReference: boolean;
  referenceUrl?: string;
}) {
  const router = useRouter();
  return (
    <Tabs
      className="w-full"
      onValueChange={(value) => {
        const url = value === "reference" ? referenceUrl : "/";
        if (url) void router.navigate({ href: url });
      }}
      size="compact"
      value={inReference ? "reference" : "guides"}
    >
      <TabsList className="w-full *:flex-1">
        <TabItem icon={BookOpen} label="Guides" value="guides" />
        {referenceUrl ? (
          <TabItem icon={Code} label="Reference" value="reference" />
        ) : null}
      </TabsList>
    </Tabs>
  );
}

// System, light or dark, as an icon-only segmented switch.
function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <Tabs
      onValueChange={setTheme}
      size="compact"
      value={mounted ? (theme ?? "system") : "system"}
    >
      <TabsList aria-label="Theme">
        <TabItem
          aria-label="System theme"
          icon={Monitor}
          label=""
          value="system"
        />
        <TabItem aria-label="Light theme" icon={Sun} label="" value="light" />
        <TabItem aria-label="Dark theme" icon={Moon} label="" value="dark" />
      </TabsList>
    </Tabs>
  );
}

function OpenApp({ appUrl, compact }: { appUrl: string; compact?: boolean }) {
  return (
    <Button
      render={<a href={appUrl} />}
      size={compact ? "compact" : undefined}
      trailingIcon={ArrowUpRight}
    >
      Open the app
    </Button>
  );
}

// The sidebar's contents beside the page on wide screens.
function SidebarBody({
  onSearch,
  tree,
}: {
  onSearch: () => void;
  tree: PageTree.Root;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { guides, reference } = splitTree(tree);
  const root = reference[0];
  const inReference = reference.some((folder) => contains(folder, pathname));
  const referenceUrl = root ? firstPage(root) : undefined;

  return (
    <>
      <SidebarHeader className="gap-3 px-3 pt-0 pb-3">
        <PageLink className="flex h-14 items-center gap-2 px-1.5" url="/">
          <Wordmark />
          <span
            className="lockup text-muted-foreground"
            style={{ fontVariationSettings: fontWeights.normal }}
          >
            Docs
          </span>
        </PageLink>
        <SearchTrigger onOpen={onSearch} />
        <SectionSwitch inReference={inReference} referenceUrl={referenceUrl} />
      </SidebarHeader>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
        <nav
          aria-label={inReference ? "Reference" : "Guides"}
          className="w-64 pt-2 pr-4 pb-6 pl-3"
        >
          {inReference && root ? (
            <ReferenceRows folder={root} pathname={pathname} />
          ) : (
            <GuideRows nodes={guides} pathname={pathname} />
          )}
        </nav>
      </ScrollArea>
      <SidebarFooter className="flex-row items-center justify-start px-4 pt-3 pb-4">
        <ThemeSwitch />
      </SidebarFooter>
    </>
  );
}

type SearchItem = CommandMenuItemData & { url: string };

// Where each page sits, for the line under a search hit.
function pageIndex(tree: PageTree.Root) {
  const { guides, reference } = splitTree(tree);
  const pages = new Map<
    string,
    { label: string; group: string; path: string }
  >();
  for (const node of guides)
    if (node.type === "page")
      pages.set(node.url, {
        label: guideLabel(node),
        group: "Guides",
        path: "Guides",
      });
  for (const root of reference) {
    if (root.index)
      pages.set(root.index.url, {
        label: "Introduction",
        group: "Reference",
        path: "Reference",
      });
    for (const tag of root.children)
      if (tag.type === "folder")
        for (const page of folderPages(tag)) {
          const { label, method } = rowLabel(page.name);
          pages.set(page.url, {
            label,
            group: "Reference",
            path: method ? `${textOf(tag.name)} · ${method}` : textOf(tag.name),
          });
        }
  }
  return pages;
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
  const pages = useMemo(() => pageIndex(tree), [tree]);
  const items = useMemo((): SearchItem[] => {
    const go = (url: string) => () => {
      void router.navigate({ href: url });
    };
    if (search === "" || query.data === "empty")
      return [...pages]
        .filter(
          ([, page]) => page.group === "Guides" || page.path === "Reference",
        )
        .map(([url, page]) => ({
          url,
          value: url,
          label: page.label,
          description: page.path,
          group: page.group,
          icon: page.group === "Reference" ? Braces : FileText,
          onSelect: go(url),
        }));
    return (query.data ?? []).map((result) => {
      const url = result.url.split("#")[0] ?? result.url;
      const page = pages.get(url);
      const reference = page?.group === "Reference";
      const heading = result.type !== "page";
      return {
        url: result.url,
        value: result.id,
        label: heading
          ? textOf(result.content)
          : (page?.label ?? textOf(result.content)),
        description: heading ? (page?.label ?? "") : (page?.path ?? ""),
        group: page?.group ?? "Guides",
        icon: heading ? Hash : reference ? Braces : FileText,
        onSelect: go(result.url),
      };
    });
  }, [pages, query.data, router, search]);

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

function Crumbs({ tree }: { tree: PageTree.Root }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const crumbs = crumbsFor(tree, pathname);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol
        className={cn(typeClass("body"), "flex min-w-0 items-center gap-1.5")}
      >
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment key={index}>
              {index > 0 ? (
                <ChevronRight
                  aria-hidden
                  className="shrink-0 text-muted-foreground"
                  size={14}
                />
              ) : null}
              <li className={cn("truncate", last ? "min-w-0" : "shrink-0")}>
                {last ? (
                  <span
                    aria-current="page"
                    className="text-foreground"
                    style={{ fontVariationSettings: fontWeights.medium }}
                  >
                    {crumb.label}
                  </span>
                ) : crumb.url ? (
                  <PageLink
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    url={crumb.url}
                  >
                    {crumb.label}
                  </PageLink>
                ) : (
                  <span className="text-muted-foreground">{crumb.label}</span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

function CopyPage({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      leadingIcon={copied ? Check : Copy}
      onClick={() => {
        void navigator.clipboard.writeText(markdown).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      variant="ghost"
    >
      {copied ? "Copied" : "Copy page"}
    </Button>
  );
}

// The panel's top bar on wide screens: where the page sits, and the way into
// the app. The page dissolves under it through the scroll fade.
function TopBar({
  appUrl,
  markdown,
  tree,
}: {
  appUrl: string;
  markdown?: string;
  tree: PageTree.Root;
}) {
  return (
    <header className="hidden h-14 shrink-0 items-center gap-4 pr-2.5 pl-6 lg:flex">
      <Crumbs tree={tree} />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {markdown ? <CopyPage markdown={markdown} /> : null}
        <OpenApp appUrl={appUrl} />
      </div>
    </header>
  );
}

// The lockup never truncates: when the bar is too narrow for "Docs" too,
// "Docs" wraps onto a second line the bar's height hides.
function Lockup({ onClick }: { onClick?: () => void }) {
  return (
    <PageLink
      className="flex h-[27px] min-w-0 flex-wrap items-center gap-x-1.5 overflow-hidden"
      onClick={onClick}
      url="/"
    >
      <Wordmark className="shrink-0" />
      <span
        className="lockup shrink-0 text-muted-foreground"
        style={{ fontVariationSettings: fontWeights.normal }}
      >
        Docs
      </span>
    </PageLink>
  );
}

// The bar below lg: the menu control at the left, then the lockup (or the
// folded contents), search and the way into the app. The open menu repeats
// it in place, with the close control where the menu button was.
function MobileBar({
  appUrl,
  children,
  className,
  leading,
  onSearch,
}: {
  appUrl: string;
  children: ReactNode;
  className?: string;
  leading: ReactNode;
  onSearch: () => void;
}) {
  return (
    <header
      className={cn(
        "relative z-20 flex h-13 shrink-0 items-center gap-1 bg-surface-2 pr-5 pl-[11px] lg:hidden",
        className,
      )}
    >
      {leading}
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex shrink-0 items-center">
        <Button
          aria-label="Search documentation"
          className="w-8! text-muted-foreground"
          onClick={onSearch}
          size="icon"
          variant="ghost"
        >
          <Search size={18} />
        </Button>
        <OpenApp appUrl={appUrl} compact />
      </div>
    </header>
  );
}

// Guides or Reference in the menu: a row that swaps the list below it.
function SectionRow({
  active,
  icon,
  label,
  onSelect,
}: {
  active: boolean;
  icon: typeof Home;
  label: string;
  onSelect: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-pressed={active}
        icon={icon}
        isActive={active}
        onClick={onSelect}
      >
        {label}
      </SidebarMenuButton>
      {active ? null : (
        <SidebarMenuBadge>
          <ChevronRight size={14} />
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
}

// Below lg the menu fills the screen under the same bar: the two halves of
// the docs as rows, the section's pages below a divider, and the theme at
// the end of the list.
function MobileMenu({
  appUrl,
  onClose,
  onSearch,
  tree,
}: {
  appUrl: string;
  onClose: () => void;
  onSearch: () => void;
  tree: PageTree.Root;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { guides, reference } = splitTree(tree);
  const root = reference[0];
  const [inReference, setInReference] = useState(() =>
    reference.some((folder) => contains(folder, pathname)),
  );

  return (
    <>
      <MobileBar
        appUrl={appUrl}
        leading={
          <SheetClose
            render={
              <Button
                aria-label="Close navigation"
                className="text-muted-foreground"
                size="icon"
                variant="ghost"
              />
            }
          >
            <X size={18} />
          </SheetClose>
        }
        className="shadow-[inset_0_-1px_0_var(--border)]"
        onSearch={onSearch}
      >
        <Lockup onClick={onClose} />
      </MobileBar>
      <ShapeProvider defaultShape="rounded">
        <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
          <nav
            aria-label="Documentation"
            className="flex flex-col px-3 pt-2 pb-8 [&_[data-sidebar=menu-badge]]:top-3 [&_[data-sidebar=menu-button]]:h-11 [&_[data-sidebar=menu-sub-button]]:h-11"
            onClickCapture={(event) => {
              if (event.target instanceof Element && event.target.closest("a"))
                onClose();
            }}
          >
            <SidebarMenu aria-label="Sections" className="gap-0.5">
              <SectionRow
                active={!inReference}
                icon={BookOpen}
                label="Guides"
                onSelect={() => setInReference(false)}
              />
              {root ? (
                <SectionRow
                  active={inReference}
                  icon={Code}
                  label="Reference"
                  onSelect={() => setInReference(true)}
                />
              ) : null}
            </SidebarMenu>
            <hr className="mx-2 my-3 h-px border-0 bg-border" />
            {inReference && root ? (
              <ReferenceRows folder={root} pathname={pathname} />
            ) : (
              <GuideRows nodes={guides} pathname={pathname} />
            )}
            <hr className="mx-2 my-3 h-px border-0 bg-border" />
            <div className="flex items-center gap-3 pl-2">
              <span className={cn(typeClass("body"), "text-foreground")}>
                Theme
              </span>
              <ThemeSwitch />
            </div>
          </nav>
        </ScrollArea>
      </ShapeProvider>
    </>
  );
}

// Below lg: one compact bar. The lockup sits left until the title scrolls
// away, then folds to the mark and the section in view.
function MobileHeader({
  appUrl,
  hasToc,
  onSearch,
  panel,
  title,
  tree,
}: {
  appUrl: string;
  hasToc: boolean;
  onSearch: () => void;
  panel: RefObject<HTMLElement | null>;
  title?: string;
  tree: PageTree.Root;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [folded, setFolded] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);

  // The header hairline appears once the page scrolls, and the lockup folds
  // into the contents once the title has scrolled under the header.
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    setScrolled(false);
    setFolded(false);
    const onScroll = (event: Event) => {
      if (!(event.target instanceof HTMLElement)) return;
      setScrolled(event.target.scrollTop > 0);
      const title = element.querySelector("[data-page-title]");
      if (!hasToc || !title) return;
      const header = element.getBoundingClientRect().top + 52;
      setFolded(title.getBoundingClientRect().bottom < header);
    };
    element.addEventListener("scroll", onScroll, { capture: true });
    return () =>
      element.removeEventListener("scroll", onScroll, { capture: true });
  }, [hasToc, panel, pathname]);

  return (
    <>
      <MobileBar
        appUrl={appUrl}
        className={cn(
          "transition-shadow",
          scrolled && "shadow-[inset_0_-1px_0_var(--border)]",
        )}
        leading={
          <Button
            aria-label="Open navigation"
            className="text-muted-foreground"
            onClick={() => setMenuOpen(true)}
            size="icon"
            variant="ghost"
          >
            <Menu size={18} />
          </Button>
        }
        onSearch={onSearch}
      >
        {folded ? <MobileContents title={title} /> : <Lockup />}
      </MobileBar>
      <Sheet onOpenChange={setMenuOpen} open={menuOpen}>
        <SheetContent
          className="inset-0 h-svh w-full max-w-none gap-0 rounded-none border-0! bg-surface-2 p-0 text-foreground shadow-none! transition-none lg:hidden"
          showCloseButton={false}
          side="top"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SurfaceProvider value={2}>
            <MobileMenu
              appUrl={appUrl}
              onClose={() => setMenuOpen(false)}
              onSearch={() => {
                setMenuOpen(false);
                onSearch();
              }}
              tree={tree}
            />
          </SurfaceProvider>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function DocsShell({
  tree,
  appUrl,
  markdown,
  title,
  toc = [],
  children,
}: {
  tree: PageTree.Root;
  appUrl: string;
  markdown?: string;
  title?: string;
  toc?: TOCItemType[];
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const touch = useTouchPrimary();
  const headings = useMemo(() => (touch ? [...toc] : toc), [toc, touch]);
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
  const openSearch = () => setSearchOpen(true);

  return (
    <SidebarProvider
      className="h-svh"
      mobileBreakpoint={1024}
      persist={false}
      shortcut={null}
    >
      <ShapeProvider defaultShape="rounded">
        <Sidebar rail={false} variant="inset">
          <SidebarBody onSearch={openSearch} tree={tree} />
        </Sidebar>
      </ShapeProvider>
      <SidebarInset
        className="min-h-0 overflow-hidden max-lg:m-0! max-lg:rounded-none! max-lg:bg-surface-2 max-lg:shadow-none!"
        ref={panel}
      >
        <TOCProvider toc={headings}>
          <SurfaceProvider value={2}>
            <MobileHeader
              appUrl={appUrl}
              hasToc={toc.length > 0}
              onSearch={openSearch}
              panel={panel}
              title={title}
              tree={tree}
            />
            <TopBar appUrl={appUrl} markdown={markdown} tree={tree} />
            {toc.length > 0 ? <OnThisPagePopover /> : null}
            <ScrollArea
              className="min-h-0 flex-1"
              viewportClassName="scroll-fade"
            >
              {children}
            </ScrollArea>
          </SurfaceProvider>
        </TOCProvider>
      </SidebarInset>
      <DocsSearch onOpenChange={setSearchOpen} open={searchOpen} tree={tree} />
    </SidebarProvider>
  );
}
