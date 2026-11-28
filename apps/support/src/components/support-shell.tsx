import { Button } from "@preprocess/ui/components/button";
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
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "@preprocess/ui/components/sidebar";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@preprocess/ui/components/sidebar-menu";
import { useTouchPrimary } from "@preprocess/ui/hooks/use-touch-primary";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  FileText,
  Hash,
  Headset,
  Home,
  Menu,
  Moon,
  Search,
  Sun,
  TextAlignStart,
  X,
} from "@preprocess/ui/lib/icons";
import type * as SearchModule from "@preprocess/search";
import { ShapeProvider } from "@preprocess/ui/lib/shape-context";
import { spring } from "@preprocess/ui/lib/springs";
import { SurfaceProvider } from "@preprocess/ui/lib/surface-context";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";
import { useRouter, useRouterState } from "@tanstack/react-router";
import type { TOCItemType } from "fumadocs-core/toc";
import { TOCProvider } from "fumadocs-ui/components/toc";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTheme } from "next-themes";
import {
  createContext,
  Fragment,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import type { HelpCenter } from "@/lib/help";
import type { HelpSearchIndex } from "@/routes/api/search";

import { MobileContents, OnThisPagePopover } from "./article-toc";
import { crumbsFor, HelpLink } from "./help-link";
import { Wordmark } from "./wordmark";

// The help center uses the docs' shell (apps/docs/src/components/
// docs-shell.tsx) as it is: a sidebar on the surface-1 chrome and the page on
// an inset surface-2 panel. In place of the docs' sections, the sidebar lists
// the six categories with their articles.

const OpenSearch = createContext<() => void>(() => undefined);

// Opens the search dialog, for the search box on the home page.
export const useOpenSearch = () => use(OpenSearch);

const contactUrl = "/contact";

function useShortcutLabel() {
  const [label, setLabel] = useState("⌘K");
  useEffect(() => {
    if (!isMacPlatform()) setLabel("Ctrl K");
  }, []);
  return label;
}

export function SearchTrigger({ onOpen }: { onOpen: () => void }) {
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
      <span className="min-w-0 flex-1 truncate text-left">Search help</span>
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

// Light or dark, one icon button as the docs have it. The system theme
// applies until the person picks one.
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

// Our status page, where the stage links one.
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

function OpenApp({ appUrl }: { appUrl: string }) {
  return (
    <Button render={<a href={appUrl} />} trailingIcon={ArrowUpRight}>
      Open the app
    </Button>
  );
}

// The help center's pages: home and the docs, then each category's articles
// under its name.
function NavRows({ help, pathname }: { help: HelpCenter; pathname: string }) {
  return (
    <>
      <SidebarMenu aria-label="Help center" className="gap-0.5">
        <SidebarMenuItem>
          <SidebarMenuButton
            icon={Home}
            isActive={pathname === "/"}
            render={<HelpLink url="/" />}
          >
            Overview
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton icon={BookOpen} render={<a href={help.docsUrl} />}>
            Docs
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      {help.categories.map((category) => (
        <SidebarGroup className="px-0 pt-6" key={category.slug}>
          <SidebarGroupLabel
            className={cn(
              typeClass("caption"),
              "h-auto px-2 pb-1.5 text-foreground",
            )}
            render={<HelpLink url={category.url} />}
            style={{ fontVariationSettings: fontWeights.medium }}
          >
            {category.title}
          </SidebarGroupLabel>
          <SidebarMenu aria-label={category.title} className="gap-0.5">
            {category.articles.map((article) => (
              <SidebarMenuItem key={article.url}>
                <SidebarMenuButton
                  isActive={article.url === pathname}
                  render={<HelpLink url={article.url} />}
                >
                  {article.title}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  );
}

// The sidebar's contents beside the page on wide screens.
function SidebarBody({
  help,
  onSearch,
}: {
  help: HelpCenter;
  onSearch: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <>
      <SidebarHeader className="gap-3 px-3 pt-0 pb-3">
        <HelpLink className="flex h-14 items-center gap-2 px-1.5" url="/">
          <Wordmark />
          <span
            className="lockup text-muted-foreground"
            style={{ fontVariationSettings: fontWeights.normal }}
          >
            Support
          </span>
        </HelpLink>
        <SearchTrigger onOpen={onSearch} />
      </SidebarHeader>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
        <nav aria-label="Help center" className="w-64 pt-2 pr-4 pb-6 pl-3">
          <NavRows help={help} pathname={pathname} />
        </nav>
      </ScrollArea>
      <SidebarFooter className="flex-row items-center gap-1 px-4 pt-3 pb-4">
        <Button
          className="min-w-0 flex-1 justify-start"
          leadingIcon={Headset}
          render={<HelpLink url={contactUrl} />}
          size="sm"
          variant="ghost"
        >
          Contact support
        </Button>
        <StatusLink url={help.statusUrl} />
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
  articles: ReturnType<typeof SearchModule.createSearchIndex>;
  docs: ReturnType<typeof SearchModule.createSearchIndex>;
};

// Orama and the index load on first open, not with the page.
let engine: Promise<SearchEngine> | undefined;
function loadEngine() {
  engine ??= Promise.all([
    import("@preprocess/search"),
    fetch("/api/search").then((response): Promise<HelpSearchIndex> => {
      if (!response.ok) throw new Error(`search index: ${response.status}`);
      return response.json();
    }),
  ]).then(([search, index]) => ({
    ...search,
    articles: search.createSearchIndex(index.articles),
    docs: search.createSearchIndex(index.docs),
  }));
  engine.catch(() => (engine = undefined));
  return engine;
}

const articlesGroup = "Help articles";
const docsGroup = "Docs";

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

// The docs' search dialog over two indexes: help articles first, then the
// docs pages, which open on the docs site.
function HelpSearch({
  help,
  open,
  onOpenChange,
}: {
  help: HelpCenter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [ready, setReady] = useState<SearchEngine>();
  useEffect(() => {
    if (open && !ready) void loadEngine().then(setReady, () => undefined);
  }, [open, ready]);
  const items = useMemo((): SearchItem[] => {
    const go = (url: string) => () => {
      if (/^https?:/.test(url)) window.location.assign(url);
      else void router.navigate({ href: url });
    };
    const term = search.trim();
    if (term === "")
      return help.categories.flatMap((category) =>
        category.articles.map((article) => ({
          url: article.url,
          value: article.url,
          label: article.title,
          description: category.title,
          group: articlesGroup,
          icon: FileText,
          onSelect: go(article.url),
        })),
      );
    if (!ready) return [];
    const results = (
      index: SearchEngine["articles"],
      group: string,
    ): SearchItem[] =>
      ready.searchIndex(index, term).flatMap((result) => [
        {
          url: result.url,
          value: `page:${result.url}`,
          label: result.title,
          parts: ready.snippet(result.title, term),
          description: result.description,
          group,
          icon: group === docsGroup ? BookOpen : FileText,
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
      ]);
    return [
      ...results(ready.articles, articlesGroup),
      ...results(ready.docs, docsGroup),
    ];
  }, [help, ready, router, search]);

  return (
    <CommandMenuDialog
      description="Search help articles and the docs."
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
        <CommandMenuInput placeholder="Search help" />
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

function Crumbs({ help }: { help: HelpCenter }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const crumbs = crumbsFor(help, pathname);
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
                  <HelpLink
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    url={crumb.url}
                  >
                    {crumb.label}
                  </HelpLink>
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

// The panel's top bar on wide screens: where the page sits, and the way into
// the app.
function TopBar({ help }: { help: HelpCenter }) {
  return (
    <header className="hidden h-14 shrink-0 items-center gap-4 pr-2.5 pl-6 lg:flex">
      <Crumbs help={help} />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <OpenApp appUrl={help.appUrl} />
      </div>
    </header>
  );
}

function Lockup({ onClick }: { onClick?: () => void }) {
  return (
    <HelpLink
      className="flex h-[27px] min-w-0 flex-wrap items-center gap-x-1.5 overflow-hidden"
      onClick={onClick}
      url="/"
    >
      <Wordmark className="shrink-0" />
      <span
        className="lockup shrink-0 text-muted-foreground"
        style={{ fontVariationSettings: fontWeights.normal }}
      >
        Support
      </span>
    </HelpLink>
  );
}

// The bar below lg: the lockup at the left, then search and the menu control
// at the right edge.
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
        aria-label="Search help"
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

// Below lg the menu fills the screen under the same bar: the help center's
// pages, then one row with the way into the app, contact, status and theme.
function MobileMenu({
  help,
  onClose,
  onSearch,
}: {
  help: HelpCenter;
  onClose: () => void;
  onSearch: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
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
            aria-label="Help center"
            className="flex flex-col px-3 pt-2 pb-8 [&_[data-sidebar=menu-button]]:h-11"
            onClickCapture={(event) => {
              if (event.target instanceof Element && event.target.closest("a"))
                onClose();
            }}
          >
            <NavRows help={help} pathname={pathname} />
            <hr className="mx-2 my-3 h-px border-0 bg-border" />
            <ShapeProvider defaultShape="pill">
              <div className="flex items-center gap-2 px-2 pt-3">
                <Button
                  className="h-11 min-w-0 flex-1 rounded-full"
                  render={<a href={help.appUrl} />}
                  trailingIcon={ArrowUpRight}
                >
                  Open the app
                </Button>
                <ThemeToggle
                  className="size-11 rounded-full"
                  variant="tertiary"
                />
                <Button
                  aria-label="Contact support"
                  className="size-11 rounded-full text-muted-foreground hover:text-foreground"
                  render={<HelpLink url={contactUrl} />}
                  size="icon-sm"
                  title="Contact support"
                  variant="tertiary"
                >
                  <Headset aria-hidden />
                </Button>
                <StatusLink
                  className="size-11 rounded-full"
                  url={help.statusUrl}
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
  hasToc,
  help,
  onSearch,
  panel,
  title,
}: {
  hasToc: boolean;
  help: HelpCenter;
  onSearch: () => void;
  panel: RefObject<HTMLElement | null>;
  title?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [pastTitle, setPastTitle] = useState(false);
  const reduceMotion = useReducedMotion();
  useEffect(() => setMenuOpen(false), [pathname]);

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
              help={help}
              onClose={() => setMenuOpen(false)}
              onSearch={() => {
                setMenuOpen(false);
                onSearch();
              }}
            />
          </SurfaceProvider>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function SupportShell({
  help,
  title,
  toc = [],
  children,
}: {
  help: HelpCenter;
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
    <OpenSearch value={openSearch}>
      <SidebarProvider
        className="h-svh"
        mobileBreakpoint={1024}
        persist={false}
        shortcut={null}
      >
        <ShapeProvider defaultShape="rounded">
          <Sidebar rail={false} variant="inset">
            <SidebarBody help={help} onSearch={openSearch} />
          </Sidebar>
        </ShapeProvider>
        <SidebarInset
          className="min-h-0 overflow-hidden max-lg:m-0! max-lg:rounded-none! max-lg:bg-surface-2 max-lg:shadow-none!"
          ref={panel}
        >
          <TOCProvider toc={headings}>
            <SurfaceProvider value={2}>
              <MobileHeader
                hasToc={toc.length > 0}
                help={help}
                onSearch={openSearch}
                panel={panel}
                title={title}
              />
              <TopBar help={help} />
              {toc.length > 0 ? <OnThisPagePopover /> : null}
              <ScrollArea
                className="min-h-0 flex-1"
                ref={(root) => {
                  root
                    ?.querySelector('[data-slot="scroll-area-viewport"]')
                    ?.setAttribute(
                      "data-scroll-restoration-id",
                      "support-content",
                    );
                }}
                viewportClassName="scroll-fade"
              >
                {children}
              </ScrollArea>
            </SurfaceProvider>
          </TOCProvider>
        </SidebarInset>
        <HelpSearch
          help={help}
          onOpenChange={setSearchOpen}
          open={searchOpen}
        />
      </SidebarProvider>
    </OpenSearch>
  );
}
