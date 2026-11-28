import { Button } from "@preprocess/ui/components/button";
import {
  DropdownContent,
  DropdownMenu,
  DropdownTrigger,
} from "@preprocess/ui/components/dropdown";
import { MenuItem } from "@preprocess/ui/components/menu-item";
import {
  CommandMenu,
  CommandMenuDialog,
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuInput,
  CommandMenuItem,
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
  SidebarGroup,
  SidebarFooter,
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
import { useTouchPrimary } from "@preprocess/ui/hooks/use-touch-primary";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Braces,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Code,
  Copy,
  FileText,
  Hash,
  Headset,
  Home,
  Menu,
  Moon,
  Search,
  Sun,
  Terminal,
  TextAlignStart,
  X,
} from "@preprocess/ui/lib/icons";
import { ShapeProvider } from "@preprocess/ui/lib/shape-context";
import { spring } from "@preprocess/ui/lib/springs";
import { SurfaceProvider } from "@preprocess/ui/lib/surface-context";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";
import type * as SearchModule from "@preprocess/search";
import type { SearchPage } from "@preprocess/search";
import { useRouter, useRouterState } from "@tanstack/react-router";
import type { TOCItemType } from "fumadocs-core/toc";
import type * as PageTree from "fumadocs-core/page-tree";
import { TOCProvider } from "fumadocs-ui/components/toc";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTheme } from "next-themes";
import {
  Fragment,
  useEffect,
  useId,
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
  PageLink,
  pageLabel,
  rowLabel,
  sectionFor,
  sectionsOf,
  textOf,
} from "./page-tree";

import { MobileContents, OnThisPagePopover } from "./docs-toc";
import { Wordmark } from "./wordmark";

// The docs use the app's own shell: a sidebar on the surface-1 chrome and the
// page on an inset surface-2 panel. Fumadocs supplies the page tree and the
// search index.

// Each section by its first page's URL.
const sectionIcons: Record<string, typeof Home> = {
  "/": BookOpen,
  "/sdk": Code,
  "/cli": Terminal,
  "/api": Braces,
};

const sectionIcon = (section: PageTree.Folder) =>
  sectionIcons[firstPage(section) ?? ""] ?? BookOpen;

// Sections whose anchors became pages of their own. The server never sees a
// hash, so the page redirects old links once it loads.
const movedAnchors: Record<string, Record<string, string>> = {
  "/sdk": {
    tools: "/sdk/tools",
    secrets: "/sdk/secrets",
    "mcp-servers": "/sdk/mcp-servers",
    "output-schema": "/sdk/output-schema",
    approvals: "/sdk/approvals",
    "groups-and-schedules": "/sdk/groups-and-schedules",
    sandbox: "/sdk/sandbox",
    memory: "/sdk/memory",
    "searching-past-cases": "/sdk/searching-past-cases",
  },
  "/cli": {
    deploy: "/cli/deploy",
    "keep-settings-in-step": "/cli/settings",
    "logs-and-evals": "/cli/logs-and-evals",
    reference: "/cli/reference",
  },
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
      <SidebarMenuSub className="ml-0 border-l-0 pl-0" open={open}>
        {folderPages(folder).map((page) => (
          <PageRow item={page} key={page.url} pathname={pathname} />
        ))}
      </SidebarMenuSub>
    </SidebarMenuItem>
  );
}

// One section's pages: its first page with the section's icon, then its
// pages and folders, in groups under the labels the section's separators
// name.
function SectionRows({
  pathname,
  section,
}: {
  pathname: string;
  section: PageTree.Folder;
}) {
  const first = firstPage(section);
  const groups: { label?: string; nodes: PageTree.Node[] }[] = [
    { nodes: section.index ? [section.index] : [] },
  ];
  for (const node of section.children)
    if (node.type === "separator")
      groups.push({ label: textOf(node.name), nodes: [] });
    else groups[groups.length - 1]?.nodes.push(node);

  return groups.map((group, index) => {
    if (group.nodes.length === 0) return null;
    const menu = (
      <SidebarMenu
        aria-label={group.label ?? textOf(section.name)}
        className="gap-0.5"
      >
        {group.nodes.map((node, key) =>
          node.type === "page" ? (
            <SidebarMenuItem key={node.url}>
              <SidebarMenuButton
                icon={
                  node.url === first
                    ? first === "/api"
                      ? Braces
                      : Home
                    : undefined
                }
                isActive={node.url === pathname}
                render={<PageLink url={node.url} />}
              >
                {pageLabel(section, node)}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : node.type === "folder" ? (
            <FolderRow folder={node} key={key} pathname={pathname} />
          ) : null,
        )}
      </SidebarMenu>
    );
    return group.label ? (
      <SidebarGroup className="px-0 pt-6" key={index}>
        <SidebarGroupLabel
          className={cn(
            typeClass("caption"),
            "h-auto px-2 pb-1.5 text-foreground",
          )}
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {group.label}
        </SidebarGroupLabel>
        {menu}
      </SidebarGroup>
    ) : (
      <Fragment key={index}>{menu}</Fragment>
    );
  });
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

// The docs' sections as one menu under search. The trigger names the
// section you are in; picking another opens its first page. In the mobile
// menu the trigger and rows take the 44px touch height.
function SectionSwitch({
  touch = false,
  tree,
}: {
  touch?: boolean;
  tree: PageTree.Root;
}) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const labelId = useId();
  const sections = sectionsOf(tree);
  const current = sectionFor(tree, pathname);
  if (!current) return null;
  const Icon = sectionIcon(current);
  return (
    <DropdownMenu>
      <DropdownTrigger
        aria-labelledby={`${labelId}-name ${labelId}-value`}
        className={cn(
          typeClass("body"),
          "flex w-full shrink-0 items-center gap-2 rounded-[10px] px-2.5 text-foreground shadow-[inset_0_0_0_1px_var(--input)] outline-none transition-colors focus-visible:shadow-[inset_0_0_0_1px_var(--input),0_0_0_2px_var(--focus-ring,#6B97FF)] data-[popup-open]:bg-active",
          touch ? "h-11 text-[15px]" : "h-9",
        )}
      >
        <span className="sr-only" id={`${labelId}-name`}>
          Docs section
        </span>
        <Icon className="shrink-0" size={16} />
        <span
          className="min-w-0 flex-1 truncate text-left"
          id={`${labelId}-value`}
          style={{ fontVariationSettings: fontWeights.medium }}
        >
          {textOf(current.name)}
        </span>
        <ChevronsUpDown className="shrink-0 text-muted-foreground" size={14} />
      </DropdownTrigger>
      <DropdownContent
        checkedIndex={sections.indexOf(current)}
        className={cn(
          "w-[var(--anchor-width)]",
          touch &&
            "[&_[data-fluid-hover-index]]:h-11 [&_[data-fluid-hover-index]]:text-[15px]",
        )}
      >
        {sections.map((section, index) => (
          <MenuItem
            checked={section === current}
            icon={sectionIcon(section)}
            index={index}
            key={index}
            label={textOf(section.name)}
            onSelect={() => {
              const url = firstPage(section);
              if (url) void router.navigate({ href: url });
            }}
          />
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}

// Light or dark, one icon button as www.preprocess.com has it. The system
// theme applies until the person picks one. Both icons render and the
// .dark class picks one, so the icon is right before hydration; the label
// follows the theme once it is known.
function ThemeToggle({
  className,
  variant = "ghost",
}: {
  className?: string;
  variant?: "ghost" | "tertiary";
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";
  const nextTheme = isDark ? "light" : "dark";
  return (
    <Button
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={isDark}
      className={cn("text-muted-foreground hover:text-foreground", className)}
      onClick={() => setTheme(nextTheme)}
      size="icon-sm"
      title={`Switch to ${nextTheme} mode`}
      type="button"
      variant={variant}
    >
      <Moon aria-hidden className="dark:hidden" />
      <Sun aria-hidden className="hidden dark:block" />
    </Button>
  );
}

const supportHref = "mailto:support@preprocess.com";

// Support by email, beside GitHub and the theme.
function SupportLink({
  className,
  variant = "ghost",
}: {
  className?: string;
  variant?: "ghost" | "tertiary";
}) {
  return (
    <Button
      aria-label="Support"
      className={cn("text-muted-foreground hover:text-foreground", className)}
      render={<a href={supportHref} />}
      size="icon-sm"
      title="Support"
      variant={variant}
    >
      <Headset aria-hidden />
    </Button>
  );
}

// Our status page, where the install links one.
function StatusLink({
  className,
  url,
  variant = "ghost",
}: {
  className?: string;
  url: string | null;
  variant?: "ghost" | "tertiary";
}) {
  if (!url) return null;
  return (
    <Button
      aria-label="Status"
      className={cn("text-muted-foreground hover:text-foreground", className)}
      render={<a href={url} rel="noopener" target="_blank" />}
      size="icon-sm"
      title="Status"
      variant={variant}
    >
      <Activity aria-hidden />
    </Button>
  );
}

// The GitHub mark (Octicons mark-github, MIT). Lucide dropped its brand
// icons, so the kit has none to offer.
function GitHubLink({
  className,
  variant = "ghost",
}: {
  className?: string;
  variant?: "ghost" | "tertiary";
}) {
  return (
    <Button
      aria-label="GitHub"
      className={cn("text-muted-foreground hover:text-foreground", className)}
      render={
        <a
          href="https://github.com/preprocess"
          rel="noopener"
          target="_blank"
        />
      }
      size="icon-sm"
      title="GitHub"
      variant={variant}
    >
      <svg
        aria-hidden
        className="size-4"
        fill="currentColor"
        viewBox="0 0 16 16"
      >
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    </Button>
  );
}

function OpenApp({ appUrl }: { appUrl: string }) {
  return (
    <Button render={<a href={appUrl} />} trailingIcon={ArrowUpRight}>
      Open the app
    </Button>
  );
}

// The sidebar's contents beside the page on wide screens.
function SidebarBody({
  onSearch,
  statusUrl,
  tree,
}: {
  onSearch: () => void;
  statusUrl: string | null;
  tree: PageTree.Root;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = sectionFor(tree, pathname);

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
        <SectionSwitch tree={tree} />
      </SidebarHeader>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
        <nav
          aria-label={section ? textOf(section.name) : "Documentation"}
          className="w-64 pt-2 pr-4 pb-6 pl-3"
        >
          {section ? (
            <SectionRows pathname={pathname} section={section} />
          ) : null}
        </nav>
      </ScrollArea>
      <SidebarFooter className="flex-row items-center gap-1 px-4 pt-3 pb-4">
        <Button
          className="min-w-0 flex-1 justify-start"
          leadingIcon={Headset}
          render={<a href={supportHref} />}
          size="sm"
          variant="ghost"
        >
          Support
        </Button>
        <StatusLink url={statusUrl} />
        <GitHubLink />
        <ThemeToggle />
      </SidebarFooter>
    </>
  );
}

type SearchItem = CommandMenuItemData & {
  url: string;
  parts?: { text: string; match: boolean }[];
  hit?: boolean;
};

type SearchEngine = typeof SearchModule & {
  index: ReturnType<typeof SearchModule.createSearchIndex>;
};

// Orama and the index load on first open, not with the page.
let engine: Promise<SearchEngine> | undefined;
function loadEngine() {
  engine ??= Promise.all([
    import("@preprocess/search"),
    fetch("/api/search").then((response): Promise<SearchPage[]> => {
      if (!response.ok) throw new Error(`search index: ${response.status}`);
      return response.json();
    }),
  ]).then(([search, pages]) => ({
    ...search,
    index: search.createSearchIndex(pages),
  }));
  engine.catch(() => (engine = undefined));
  return engine;
}

// Where each page sits, for the line under a search hit: its section, or
// for an API operation its tag and method.
function pageIndex(tree: PageTree.Root) {
  const pages = new Map<
    string,
    { label: string; group: string; path: string; api: boolean }
  >();
  for (const section of sectionsOf(tree)) {
    const group = textOf(section.name);
    const api = firstPage(section) === "/api";
    const visit = (folder: PageTree.Folder, path: string) => {
      const items = folder.index ? [folder.index] : [];
      for (const child of folder.children)
        if (child.type === "page") items.push(child);
        else if (child.type === "folder") visit(child, textOf(child.name));
      for (const page of items) {
        const { method } = rowLabel(page.name);
        pages.set(page.url, {
          label: pageLabel(section, page),
          group,
          path: method ? `${path} · ${method}` : path,
          api,
        });
      }
    };
    visit(section, group);
  }
  return pages;
}

function Highlighted({ parts }: { parts: { text: string; match: boolean }[] }) {
  return parts.map((part, index) =>
    part.match ? (
      <mark
        className="bg-transparent text-foreground"
        key={index}
        style={{ fontVariationSettings: fontWeights.medium }}
      >
        {part.text}
      </mark>
    ) : (
      <Fragment key={index}>{part.text}</Fragment>
    ),
  );
}

function SearchRow({ item }: { item: SearchItem }) {
  return (
    <CommandMenuItem className={cn(item.hit && "ps-8")} value={item.value}>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span
          className={cn(
            "[text-box:trim-both_cap_alphabetic] -my-1 py-1",
            item.hit ? "min-w-0 flex-1 truncate" : "shrink-0",
          )}
        >
          {item.parts ? <Highlighted parts={item.parts} /> : item.label}
        </span>
        {item.description ? (
          <span
            className={cn(
              "[text-box:trim-both_cap_alphabetic] -my-1 min-w-0 truncate py-1 text-muted-foreground",
              item.hit && "max-w-2/5 shrink-0",
            )}
          >
            {item.description}
          </span>
        ) : null}
      </span>
    </CommandMenuItem>
  );
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
  const [search, setSearch] = useState("");
  const [ready, setReady] = useState<SearchEngine>();
  useEffect(() => {
    if (open && !ready) void loadEngine().then(setReady, () => undefined);
  }, [open, ready]);
  const pages = useMemo(() => pageIndex(tree), [tree]);
  const items = useMemo((): SearchItem[] => {
    const go = (url: string) => () => {
      void router.navigate({ href: url });
    };
    const term = search.trim();
    if (term === "")
      return [...pages]
        .filter(([, page]) => page.path === page.group)
        .map(([url, page]) => ({
          url,
          value: url,
          label: page.label,
          description: page.path,
          group: page.group,
          icon: page.api ? Braces : FileText,
          onSelect: go(url),
        }));
    if (!ready) return [];
    return ready.searchIndex(ready.index, term).flatMap((result) => {
      const page = pages.get(result.url);
      const label = page?.label ?? result.title;
      const group = page?.group ?? "Guides";
      return [
        {
          url: result.url,
          value: `page:${result.url}`,
          label,
          parts: ready.snippet(label, term),
          description: result.description,
          group,
          icon: page?.api ? Braces : FileText,
          onSelect: go(result.url),
        },
        ...result.hits.map((hit, index) => ({
          url: hit.url,
          value: `${hit.kind}:${hit.url}:${index}`,
          label: hit.text,
          action: `Open ${hit.heading ?? hit.text}`,
          parts: ready.snippet(hit.text, term),
          description: hit.heading,
          group,
          hit: true,
          icon: hit.kind === "heading" ? Hash : TextAlignStart,
          onSelect: go(hit.url),
        })),
      ];
    });
  }, [pages, ready, router, search]);

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
        <CommandMenuList
          renderItem={(item) => <SearchRow item={item as SearchItem} />}
        >
          <CommandMenuEmpty>
            {search.trim() && !ready ? "Loading…" : "No results found"}
          </CommandMenuEmpty>
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

// The bar below lg: the lockup at the left, then search and the menu control
// at the right edge. The open menu repeats it in place, with the close control
// where the menu button was.
function MobileBar({
  children,
  className,
  onSearch,
  trigger,
}: {
  children: ReactNode;
  className?: string;
  onSearch: () => void;
  trigger: ReactNode;
}) {
  return (
    <header
      className={cn(
        "relative z-20 flex h-13 shrink-0 items-center gap-1 bg-surface-2 pr-[11px] pl-5 lg:hidden",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <Button
        aria-label="Search documentation"
        className="shrink-0 text-muted-foreground"
        onClick={onSearch}
        size="icon"
        variant="ghost"
      >
        <Search size={18} />
      </Button>
      <div className="shrink-0">{trigger}</div>
    </header>
  );
}

// Below lg the menu fills the screen under the same bar: the section menu,
// the section's pages below a divider, then one row at the
// end of the list: the way into the app, the theme and GitHub.
function MobileMenu({
  appUrl,
  onClose,
  onSearch,
  statusUrl,
  tree,
}: {
  appUrl: string;
  onClose: () => void;
  onSearch: () => void;
  statusUrl: string | null;
  tree: PageTree.Root;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = sectionFor(tree, pathname);

  return (
    <>
      <MobileBar
        className="shadow-[inset_0_-1px_0_var(--border)]"
        onSearch={onSearch}
        trigger={
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
            <SectionSwitch touch tree={tree} />
            <hr className="mx-2 my-3 h-px border-0 bg-border" />
            {section ? (
              <SectionRows pathname={pathname} section={section} />
            ) : null}
            <hr className="mx-2 my-3 h-px border-0 bg-border" />
            <ShapeProvider defaultShape="pill">
              <div className="flex items-center gap-2 px-2 pt-3">
                <Button
                  className="h-11 min-w-0 flex-1 rounded-full"
                  render={<a href={appUrl} />}
                  trailingIcon={ArrowUpRight}
                >
                  Open the app
                </Button>
                <ThemeToggle
                  className="size-11 rounded-full"
                  variant="tertiary"
                />
                <SupportLink
                  className="size-11 rounded-full"
                  variant="tertiary"
                />
                <StatusLink
                  className="size-11 rounded-full"
                  url={statusUrl}
                  variant="tertiary"
                />
                <GitHubLink
                  className="size-11 rounded-full"
                  variant="tertiary"
                />
              </div>
            </ShapeProvider>
          </nav>
        </ScrollArea>
      </ShapeProvider>
    </>
  );
}

// Below lg: one bar that never changes on scroll, and a contents bar that
// slides in under it once the title has scrolled away.
function MobileHeader({
  appUrl,
  hasToc,
  onSearch,
  panel,
  statusUrl,
  title,
  tree,
}: {
  appUrl: string;
  hasToc: boolean;
  onSearch: () => void;
  panel: RefObject<HTMLElement | null>;
  statusUrl: string | null;
  title?: string;
  tree: PageTree.Root;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [pastTitle, setPastTitle] = useState(false);
  const reduceMotion = useReducedMotion();
  useEffect(() => setMenuOpen(false), [pathname]);

  // The header hairline appears once the page scrolls, and the contents bar
  // slides in under the header once the title has scrolled beneath it.
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    setScrolled(false);
    setPastTitle(false);
    const onScroll = (event: Event) => {
      if (!(event.target instanceof HTMLElement)) return;
      setScrolled(event.target.scrollTop > 0);
      const title = element.querySelector("[data-page-title]");
      if (!hasToc || !title) return;
      const header = element.getBoundingClientRect().top + 52;
      setPastTitle(title.getBoundingClientRect().bottom < header);
    };
    element.addEventListener("scroll", onScroll, { capture: true });
    return () =>
      element.removeEventListener("scroll", onScroll, { capture: true });
  }, [hasToc, panel, pathname]);

  return (
    <>
      <MobileBar
        className={cn(
          "transition-shadow",
          scrolled && "shadow-[inset_0_-1px_0_var(--border)]",
        )}
        onSearch={onSearch}
        trigger={
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
      >
        <Lockup />
      </MobileBar>
      <AnimatePresence>
        {hasToc && pastTitle ? (
          <motion.div
            animate={{ y: 0, opacity: 1 }}
            className="absolute inset-x-0 top-13 z-10 bg-surface-2 shadow-[inset_0_-1px_0_var(--border)] lg:hidden"
            exit={reduceMotion ? { opacity: 0 } : { y: "-100%" }}
            initial={reduceMotion ? { opacity: 0 } : { y: "-100%" }}
            transition={reduceMotion ? { duration: 0 } : spring.moderate}
          >
            <MobileContents title={title} />
          </motion.div>
        ) : null}
      </AnimatePresence>
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
              statusUrl={statusUrl}
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
  statusUrl,
  title,
  toc = [],
  children,
}: {
  tree: PageTree.Root;
  appUrl: string;
  markdown?: string;
  statusUrl: string | null;
  title?: string;
  toc?: TOCItemType[];
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const router = useRouter();
  const location = useRouterState({ select: (s) => s.location });
  useEffect(() => {
    const target = movedAnchors[location.pathname]?.[location.hash];
    if (target) void router.navigate({ href: target, replace: true });
  }, [location.hash, location.pathname, router]);
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
          <SidebarBody
            onSearch={openSearch}
            statusUrl={statusUrl}
            tree={tree}
          />
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
              statusUrl={statusUrl}
              title={title}
              tree={tree}
            />
            <TopBar appUrl={appUrl} markdown={markdown} tree={tree} />
            {toc.length > 0 ? <OnThisPagePopover /> : null}
            <ScrollArea
              className="min-h-0 flex-1"
              ref={(root) => {
                root
                  ?.querySelector('[data-slot="scroll-area-viewport"]')
                  ?.setAttribute("data-scroll-restoration-id", "docs-content");
              }}
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
