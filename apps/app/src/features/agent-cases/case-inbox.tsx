import { Badge } from "@preprocess/ui/components/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@preprocess/ui/components/context-menu";
import {
  DropdownContent,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
} from "@preprocess/ui/components/dropdown";
import { EmptyPresence } from "@preprocess/ui/components/empty";
import { FluidHoverHighlight } from "@preprocess/ui/components/fluid-hover-highlight";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { MenuItem } from "@preprocess/ui/components/menu-item";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { Tooltip } from "@preprocess/ui/components/tooltip";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@preprocess/ui/hooks/use-fluid-hover";
import { TabItem, Tabs, TabsList } from "@preprocess/ui/components/tabs";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  OrbitSparkle,
  ChevronRightIcon,
  SlidersHorizontal,
  TriangleAlertIcon,
  Users,
} from "@preprocess/ui/lib/icons";
import { ShapeProvider, useShape } from "@preprocess/ui/lib/shape-context";
import { SizeProvider } from "@preprocess/ui/lib/size-context";
import { cn } from "@preprocess/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  FilterChips,
  FilterMenu,
  type FilterFacetDef,
} from "../../components/list-controls";
import { PageHeader, PageTitle } from "../../components/page-header";
import { AddCaseButton } from "./case-start-dialog";
import { Toolbar, ToolbarButton } from "../../components/toolbar";
import { useHotkeys } from "../../components/use-hotkeys";
import { AgentPage } from "../agents/agent-page";
import type { OrgAgentDetail } from "../agents/list-org-agents";
import { SettingsSearchField } from "../settings/kit";
import {
  awaitingPhrase,
  caseDisplayId,
  caseTitle,
  formatCost,
  isCaseStatus,
  type Case,
} from "./case";
import { CaseInboxEmpty } from "./case-inbox-empty";
import {
  AWAITING_NONE,
  CASES_ENVIRONMENTS,
  CASES_GROUPINGS,
  DEFAULT_CASES_SEARCH,
  UNASSIGNED_ANY,
  type UnassignedFilter,
  rememberCasesSearch,
  type AwaitingFilter,
  type CasesEnvironment,
  type CasesGrouping,
  type CasesInboxSearch,
  type CasesView,
} from "./case-inbox-search";
import { AssigneeStack, NeedsAssignmentTag } from "./assignee-stack";
import { CaseStatusIcon } from "./case-status-icon";
import {
  caseGroupKey,
  listOrgCases,
  type CaseListPage,
} from "./list-org-cases";

const VIEW_LABEL: Record<CasesView, string> = {
  all: "All",
  active: "Active",
  waiting: "Waiting",
  done: "Done",
};

/** The status filter's order (spec 14a): everything, then what needs people. */
const VIEW_ORDER: readonly CasesView[] = ["all", "waiting", "active", "done"];

const countFormat = new Intl.NumberFormat("en");

const GROUPING_LABEL: Record<CasesGrouping, string> = {
  status: "Status",
  agent: "Agent",
  none: "No grouping",
};

/**
 * The assignment chip as a sentence: "Needs assignment", "Needs assignment
 * from Legal", "… from one of Legal, Review". "Any" alone reads plainly.
 */
function assignmentChip(selected: readonly UnassignedFilter[]): {
  lead: string;
  values: string;
} {
  const groups = selected.filter((value) => value !== UNASSIGNED_ANY);
  if (groups.length === 0) {
    return { lead: "Needs", values: selected.length > 0 ? "assignment" : "" };
  }
  const anyToo = selected.includes(UNASSIGNED_ANY);
  return {
    lead:
      groups.length > 1 || anyToo
        ? "Needs assignment from one of"
        : "Needs assignment from",
    values: [...(anyToo ? ["any group"] : []), ...groups].join(", "),
  };
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

function awaitingLabel(value: AwaitingFilter) {
  return value === AWAITING_NONE ? "No one" : value;
}

function countLabel(count: number) {
  return new Intl.NumberFormat().format(count);
}

// ─── Filter menu ─────────────────────────────────────────────────────────────

const caseCountLabel = (count: number) =>
  `${countLabel(count)} ${count === 1 ? "case" : "cases"}`;

function CaseFilterMenu({
  page,
  search,
  onChange,
  toolbarIndex,
  agentScoped,
}: Readonly<{
  /** The list is one agent's, so it has no Agent facet. */
  agentScoped: boolean;
  page: CaseListPage;
  search: CasesInboxSearch;
  onChange: (patch: Partial<CasesInboxSearch>) => void;
  toolbarIndex: number;
}>) {
  const { counts } = page;
  return (
    <FilterMenu
      countLabel={caseCountLabel}
      toolbarIndex={toolbarIndex}
      facets={(
        [
          {
            key: "agent",
            label: "Agent",
            icon: OrbitSparkle,
            options: page.agents.map((agent) => ({
              value: agent,
              label: agent,
              count: counts.agent[agent] ?? 0,
            })),
            selected: search.agent,
            onChange: (agent) => onChange({ agent }),
          },
          {
            key: "awaiting",
            label: "Awaiting",
            icon: Users,
            options: page.awaitingOptions.map((value) => ({
              value,
              label: awaitingLabel(value),
              count: counts.awaiting[value] ?? 0,
            })),
            selected: search.awaiting,
            onChange: (awaiting) => onChange({ awaiting }),
          },
          {
            key: "assignment",
            label: "Needs assignment",
            // The same caution mark the Needs assignment tag wears.
            icon: TriangleAlertIcon,
            // "Any group", then each group cases can be waiting on.
            options: page.assignmentOptions.map((value) => ({
              value,
              label: value === UNASSIGNED_ANY ? "Any group" : value,
              count: counts.unassigned[value] ?? 0,
            })),
            selected: search.unassigned,
            onChange: (unassigned) => onChange({ unassigned }),
          },
        ] satisfies FilterFacetDef[]
      ).filter(
        (facet) =>
          facet.options.length > 0 && !(agentScoped && facet.key === "agent"),
      )}
    />
  );
}

// ─── Display menu ────────────────────────────────────────────────────────────

function DisplayMenu({
  search,
  onChange,
  toolbarIndex,
  agentScoped,
}: Readonly<{
  /** The list is one agent's, so it doesn't group by agent. */
  agentScoped: boolean;
  search: CasesInboxSearch;
  onChange: (patch: Partial<CasesInboxSearch>) => void;
  toolbarIndex: number;
}>) {
  const [open, setOpen] = useState(false);
  const orderings = [
    { label: "Last updated", sort: "updatedAt", dir: "desc" },
    { label: "Oldest update", sort: "updatedAt", dir: "asc" },
    { label: "Newest", sort: "createdAt", dir: "desc" },
    { label: "Oldest", sort: "createdAt", dir: "asc" },
  ] as const;
  // Rows index across the whole popup so the fluid highlight and the
  // checked fills line up with the right items. The menu merges checked
  // rows with consecutive indices into one fill, so a skipped index between
  // the sections keeps the two checked rows apart.
  const groupings = CASES_GROUPINGS.filter(
    (group) => !(agentScoped && group === "agent"),
  );
  const orderingStart = groupings.length + 1;
  const customized =
    search.group !== DEFAULT_CASES_SEARCH.group ||
    search.sort !== DEFAULT_CASES_SEARCH.sort ||
    search.dir !== DEFAULT_CASES_SEARCH.dir;
  const checkedIndices = [
    groupings.indexOf(search.group),
    orderingStart +
      orderings.findIndex(
        (item) => item.sort === search.sort && item.dir === search.dir,
      ),
  ];

  return (
    // Menus open at the default size, though the header's controls are compact.
    <DropdownMenu onOpenChange={setOpen} open={open} size="default">
      <Tooltip content="Display" side="bottom">
        <DropdownTrigger
          aria-label="Display options"
          render={
            <ToolbarButton active={open || customized} index={toolbarIndex} />
          }
        >
          <SlidersHorizontal aria-hidden="true" />
        </DropdownTrigger>
      </Tooltip>
      <DropdownContent
        align="end"
        checkedIndices={checkedIndices}
        className="w-48"
      >
        <DropdownLabel>Grouping</DropdownLabel>
        {groupings.map((group, row) => (
          <MenuItem
            checked={search.group === group}
            index={row}
            key={group}
            label={GROUPING_LABEL[group]}
            onSelect={() => onChange({ group })}
          />
        ))}
        <DropdownSeparator />
        <DropdownLabel>Ordering</DropdownLabel>
        {orderings.map((item, row) => (
          <MenuItem
            checked={item.sort === search.sort && item.dir === search.dir}
            index={orderingStart + row}
            key={item.label}
            label={item.label}
            onSelect={() => onChange({ sort: item.sort, dir: item.dir })}
          />
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}

// ─── Active filter chips ─────────────────────────────────────────────────────

const ENVIRONMENT_LABEL: Record<CasesEnvironment, string> = {
  production: "Production",
  previews: "Previews",
};

/**
 * Production cases or the ones preview deployments ran. For Developers only;
 * until the app knows the viewer's groups it shows to everyone in dev.
 */
function CaseEnvironmentSelect({
  value,
  onChange,
}: Readonly<{
  value: CasesEnvironment;
  onChange: (env: CasesEnvironment) => void;
}>) {
  return (
    <SizeProvider size="compact">
      <Select
        onValueChange={(next) =>
          onChange(next === "previews" ? "previews" : "production")
        }
        value={value}
      >
        <SelectTrigger aria-label="Environment" className="w-32" />
        <SelectContent>
          {CASES_ENVIRONMENTS.map((env, index) => (
            <SelectItem index={index} key={env} value={env}>
              {ENVIRONMENT_LABEL[env]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SizeProvider>
  );
}

function CaseFilterChips({
  search,
  onChange,
}: Readonly<{
  search: CasesInboxSearch;
  onChange: (patch: Partial<CasesInboxSearch>) => void;
}>) {
  // Reads as a sentence: "Status is Open", "Awaiting one of Legal, Sales".
  return (
    <FilterChips
      chips={[
        {
          key: "status",
          label: "Status",
          lead: search.status.length > 1 ? "Status is one of" : "Status is",
          values: search.status.join(", "),
          onClear: () => onChange({ status: [] }),
        },
        {
          key: "agent",
          label: "Agent",
          lead: search.agent.length > 1 ? "Agent is one of" : "Agent is",
          values: search.agent.join(", "),
          onClear: () => onChange({ agent: [] }),
        },
        {
          key: "awaiting",
          label: "Awaiting",
          lead: search.awaiting.length > 1 ? "Awaiting one of" : "Awaiting",
          values: search.awaiting
            .map((value) => (value === AWAITING_NONE ? "no one" : value))
            .join(", "),
          onClear: () => onChange({ awaiting: [] }),
        },
        {
          key: "assignment",
          label: "Needs assignment",
          ...assignmentChip(search.unassigned),
          onClear: () => onChange({ unassigned: [] }),
        },
      ]}
      onClearAll={() =>
        onChange({
          status: [],
          agent: [],
          awaiting: [],
          unassigned: [],
        })
      }
    />
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────

function AwaitingTag({ groups }: Readonly<{ groups: readonly string[] }>) {
  const phrase = awaitingPhrase(groups);
  if (!phrase) return null;
  // Long team lists truncate in the row; the tooltip carries the whole list.
  return (
    <Tooltip content={phrase} side="top">
      {/* Badge wraps its children in its own label span, so that span is
          the one that has to clip. Clipping a cap-trimmed box cuts the
          descenders, so the trim comes off; the badge's fixed height and
          centering keep the text where it was. */}
      <Badge
        className="max-w-56 shrink-0 [&>span]:min-w-0 [&>span]:truncate [&>span]:[text-box:normal]"
        size="sm"
      >
        {phrase}
      </Badge>
    </Tooltip>
  );
}

function CaseRow({
  item,
  index,
  registerItem,
  showStatus,
  showAgent,
}: Readonly<{
  item: Case;
  index: number;
  registerItem: (index: number, element: HTMLElement | null) => void;
  showStatus: boolean;
  showAgent: boolean;
}>) {
  const ref = useRef<HTMLAnchorElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  const shape = useShape();

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <Link
            className={cn(
              "relative flex h-10 min-w-0 items-center gap-3 px-3 text-body outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring)",
              shape.item,
            )}
            data-case-row={index}
            params={{ agentId: item.agentId, caseId: item.id }}
            ref={ref}
            to="/agents/$agentId/cases/$caseId"
          />
        }
      >
        {showStatus ? <CaseStatusIcon status={item.status} /> : null}
        <span
          className="w-28 shrink-0 truncate text-caption text-muted-foreground tabular-nums"
          title={caseDisplayId(item)}
        >
          {caseDisplayId(item)}
        </span>
        {/* The agent sits right after the title; the title gives way
            first when the row runs short. */}
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            className="min-w-0 truncate text-foreground"
            style={{ fontVariationSettings: fontWeights.semibold }}
          >
            {caseTitle(item)}
          </span>
          {item.previewBranch ? (
            <Badge className="shrink-0" color="gray" size="sm">
              {item.previewBranch}
            </Badge>
          ) : null}
          {showAgent ? (
            <span className="shrink-0 text-caption text-muted-foreground">
              {item.agentId}
            </span>
          ) : null}
        </span>
        <AwaitingTag groups={item.awaiting} />
        <NeedsAssignmentTag item={item} />
        <AssigneeStack assignees={item.assignees} />
        <Tooltip content="Cost so far" side="top">
          <span className="w-14 shrink-0 text-right text-caption text-muted-foreground tabular-nums">
            {formatCost(item.costCents)}
          </span>
        </Tooltip>
        <time
          className="w-12 shrink-0 text-right text-caption text-muted-foreground tabular-nums"
          dateTime={item.updatedAt}
        >
          {formatDate(item.updatedAt)}
        </time>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <ContextMenuItem
          onClick={() =>
            window.open(
              `/cases/${item.agentId}/${item.id}`,
              "_blank",
              "noopener,noreferrer",
            )
          }
        >
          Open in new tab
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => void navigator.clipboard?.writeText(item.id)}
        >
          Copy case ID
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function GroupHeader({
  groupKey,
  grouping,
  total,
  collapsed,
  onToggle,
}: Readonly<{
  groupKey: string;
  grouping: CasesGrouping;
  total: number;
  collapsed: boolean;
  onToggle: () => void;
}>) {
  const shape = useShape();
  return (
    <button
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${groupKey}`}
      className={cn(
        "group/header flex h-9 w-full cursor-pointer items-center gap-2 bg-surface-3 px-3 text-left text-body outline-none transition-colors duration-80 hover:bg-surface-4 focus-visible:ring-1 focus-visible:ring-(--focus-ring)",
        shape.item,
      )}
      onClick={onToggle}
      type="button"
    >
      <ChevronRightIcon
        aria-hidden="true"
        className={cn(
          "-ml-1 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover/header:text-foreground",
          !collapsed && "rotate-90",
        )}
      />
      {grouping === "status" && isCaseStatus(groupKey) ? (
        <CaseStatusIcon status={groupKey} />
      ) : null}
      <span
        className="text-foreground"
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {groupKey}
      </span>
      <span className="text-caption text-muted-foreground tabular-nums">
        {countLabel(total)}
      </span>
    </button>
  );
}

/** Collapsed groups per grouping, kept for the session so they survive a
 *  trip into a case and back. */
const collapsedGroupsMemory = new Map<CasesGrouping, ReadonlySet<string>>();

function useCollapsedGroups(grouping: CasesGrouping) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => collapsedGroupsMemory.get(grouping) ?? new Set(),
  );
  const [shownFor, setShownFor] = useState(grouping);
  if (shownFor !== grouping) {
    setShownFor(grouping);
    setCollapsed(collapsedGroupsMemory.get(grouping) ?? new Set());
  }
  const toggle = useCallback(
    (key: string) => {
      setCollapsed((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        collapsedGroupsMemory.set(grouping, next);
        return next;
      });
    },
    [grouping],
  );
  return [collapsed, toggle] as const;
}

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 36;
/** Space under every row and header: the 4px every list in the app uses. */
const ITEM_GAP = 4;
const LIST_PADDING = 8;
/** Fetch the next batch while this many entries remain below the view. */
const LOAD_AHEAD = 20;

type ListEntry =
  | {
      kind: "header";
      key: string;
      total: number;
      collapsed: boolean;
    }
  | { kind: "row"; item: Case; row: number };

/**
 * Headers and the rows under them, in display order. Headers come from
 * `groups`, which lists every group with its total, so a collapsed group
 * shows its header without any of its rows loaded. An open group's rows
 * follow its header; the list stops at the first open group that hasn't
 * finished loading, since later groups come after the rest of it. `row`
 * counts only the rows shown, so the keyboard steps over collapsed groups.
 */
function listEntries(
  rows: readonly Case[],
  groups: CaseListPage["groups"],
  grouping: CasesGrouping,
  collapsed: ReadonlySet<string>,
): { entries: ListEntry[]; shown: Case[] } {
  const entries: ListEntry[] = [];
  const shown: Case[] = [];
  const pushRow = (item: Case) => {
    entries.push({ kind: "row", item, row: shown.length });
    shown.push(item);
  };
  if (grouping === "none") {
    rows.forEach(pushRow);
    return { entries, shown };
  }
  const byGroup = new Map<string, Case[]>();
  for (const item of rows) {
    const key = caseGroupKey(item, grouping);
    const list = byGroup.get(key);
    if (list) list.push(item);
    else byGroup.set(key, [item]);
  }
  for (const group of groups) {
    const isCollapsed = collapsed.has(group.key);
    entries.push({
      kind: "header",
      key: group.key,
      total: group.total,
      collapsed: isCollapsed,
    });
    if (isCollapsed) continue;
    const loaded = byGroup.get(group.key) ?? [];
    loaded.forEach(pushRow);
    if (loaded.length < group.total) break;
  }
  return { entries, shown };
}

function entrySize(entry: ListEntry | undefined) {
  return (entry?.kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT) + ITEM_GAP;
}

/**
 * The list as Linear draws it: one scroll, no pages. Only rows near the
 * view mount, and the next batch loads as the end comes into view.
 */
function CaseRows({
  rows,
  groups,
  search,
  collapsed,
  onToggleGroup,
  scrollElement,
  hasMore,
  onLoadMore,
  showAgent,
}: Readonly<{
  showAgent: boolean;
  rows: readonly Case[];
  groups: CaseListPage["groups"];
  search: CasesInboxSearch;
  collapsed: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  scrollElement: HTMLElement | null;
  hasMore: boolean;
  onLoadMore: () => void;
}>) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(containerRef);
  const { activeIndex, setActiveIndex } = hover;
  const shape = useShape();
  const { entries, shown } = useMemo(
    () => listEntries(rows, groups, search.group, collapsed),
    [rows, groups, search.group, collapsed],
  );
  const entryOfRow = useMemo(() => {
    const map: number[] = [];
    entries.forEach((entry, index) => {
      if (entry.kind === "row") map[entry.row] = index;
    });
    return map;
  }, [entries]);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => entrySize(entries[index]),
    overscan: 12,
    initialRect: { width: 0, height: 1080 },
    // Air between the header and the first group, and below the last row.
    paddingStart: LIST_PADDING,
    paddingEnd: LIST_PADDING,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;

  // onLoadMore changes with each batch and when a fetch settles, so this
  // checks again until the end of the list is out of reach.
  useEffect(() => {
    if (hasMore && lastIndex >= entries.length - LOAD_AHEAD) onLoadMore();
  }, [entries.length, hasMore, lastIndex, onLoadMore]);

  // The keyboard moves the same highlight the pointer does; the hover hook
  // owns the index so the two never fight over it.
  const moveActive = (delta: number) => {
    if (shown.length === 0) return;
    const next =
      activeIndex === null
        ? 0
        : Math.min(Math.max(activeIndex + delta, 0), shown.length - 1);
    setActiveIndex(next);
    const entry = entryOfRow[next];
    if (entry !== undefined) virtualizer.scrollToIndex(entry);
  };

  const openActive = () => {
    const item = activeIndex === null ? undefined : shown[activeIndex];
    if (!item) return;
    void navigate({
      to: "/agents/$agentId/cases/$caseId",
      params: { agentId: item.agentId, caseId: item.id },
    });
  };

  useHotkeys({
    j: () => moveActive(1),
    k: () => moveActive(-1),
    ArrowDown: () => moveActive(1),
    ArrowUp: () => moveActive(-1),
    Enter: openActive,
    o: openActive,
  });

  return (
    <div
      className="relative mx-2"
      onMouseEnter={hover.handlers.onMouseEnter}
      onMouseLeave={hover.handlers.onMouseLeave}
      onMouseMove={hover.handlers.onMouseMove}
      ref={containerRef}
      style={{ height: virtualizer.getTotalSize() }}
    >
      <FluidHoverHighlight hover={hover} className={shape.bg} />
      {items.map((virtual) => {
        const entry = entries[virtual.index];
        if (!entry) return null;
        return (
          <div
            className="absolute inset-x-0 pb-1"
            key={
              entry.kind === "header"
                ? `group:${entry.key}`
                : `${entry.item.agentId}:${entry.item.id}`
            }
            style={{ top: virtual.start, height: virtual.size }}
          >
            {entry.kind === "header" ? (
              <GroupHeader
                collapsed={entry.collapsed}
                groupKey={entry.key}
                grouping={search.group}
                onToggle={() => onToggleGroup(entry.key)}
                total={entry.total}
              />
            ) : (
              <CaseRow
                index={entry.row}
                item={entry.item}
                registerItem={hover.registerItem}
                showAgent={showAgent}
                showStatus={search.group !== "status"}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

/** The rows loaded so far for one first page and one set of collapsed
 *  groups. Changing either starts the list again from the top. */
type LoadedList = {
  readonly page: CaseListPage;
  readonly collapsed: ReadonlySet<string>;
  readonly rows: readonly Case[];
  readonly nextCursor: string | null;
  /** False until the first batch that skips the collapsed groups lands. */
  readonly ready: boolean;
};

function freshList(
  page: CaseListPage,
  collapsed: ReadonlySet<string>,
): LoadedList {
  // The route's first page skips nothing, so it only serves when no group
  // is collapsed; otherwise the list fetches its own first batch.
  return collapsed.size === 0
    ? {
        page,
        collapsed,
        rows: page.rows,
        nextCursor: page.nextCursor,
        ready: true,
      }
    : { page, collapsed, rows: [], nextCursor: null, ready: false };
}

export function CaseInbox({
  page,
  search,
  onSearchChange,
  agent,
  startAgents,
}: Readonly<{
  /** Shows one agent's cases inside its page, under its Cases section. */
  agent?: OrgAgentDetail;
  /** The agents the person may start cases for; the Add button shows for them. */
  startAgents: readonly string[];
  page: CaseListPage;
  search: CasesInboxSearch;
  onSearchChange: (
    next: Partial<CasesInboxSearch>,
    meta?: { replace?: boolean },
  ) => void;
}>) {
  const hasCases = page.total > 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [collapsed, toggleGroup] = useCollapsedGroups(search.group);
  const [list, setList] = useState(() => freshList(page, collapsed));
  const [loading, setLoading] = useState(false);
  const current =
    list.page === page && list.collapsed === collapsed
      ? list
      : freshList(page, collapsed);
  if (current !== list) setList(current);

  useEffect(() => {
    rememberCasesSearch(search);
  }, [search]);

  useLayoutEffect(() => {
    setScrollElement(
      scrollRef.current?.querySelector<HTMLElement>(
        "[data-slot='scroll-area-viewport']",
      ) ?? null,
    );
  }, [hasCases]);

  const sameList = (state: LoadedList) =>
    state.page === page && state.collapsed === collapsed;

  // With groups collapsed, fetch a first batch that skips them.
  useEffect(() => {
    if (current.ready) return;
    let live = true;
    void listOrgCases(search, null, collapsed).then((next) => {
      if (!live) return;
      setList((state) =>
        sameList(state)
          ? {
              ...state,
              rows: next.rows,
              nextCursor: next.nextCursor,
              ready: true,
            }
          : state,
      );
    });
    return () => {
      live = false;
    };
  }, [current.ready, page, collapsed, search]);

  const loadMore = useCallback(() => {
    const cursor = current.nextCursor;
    if (!cursor || !current.ready || loading) return;
    setLoading(true);
    void listOrgCases(search, cursor, collapsed)
      .then((next) => {
        setList((state) =>
          sameList(state) && state.nextCursor === cursor
            ? {
                ...state,
                rows: [...state.rows, ...next.rows],
                nextCursor: next.nextCursor,
              }
            : state,
        );
      })
      .finally(() => setLoading(false));
  }, [current, loading, search, collapsed, page]);

  const emptyKind = page.loadError
    ? "unavailable"
    : page.hasCases
      ? "no-match"
      : "empty";

  const agentScoped = agent !== undefined;
  const statusCounts = page.counts.status;
  const viewCount = (view: CasesView) =>
    view === "all"
      ? Object.values(statusCounts).reduce((total, n) => total + n, 0)
      : (statusCounts[VIEW_LABEL[view]] ?? 0);
  const toolbar = (
    <div className="flex items-center gap-2">
      <Tabs
        aria-label="Case status"
        onValueChange={(view) => onSearchChange({ view: view as CasesView })}
        size="compact"
        value={search.view}
      >
        <TabsList>
          {VIEW_ORDER.map((view) => (
            <TabItem
              key={view}
              label={`${VIEW_LABEL[view]} ${countFormat.format(viewCount(view))}`}
              value={view}
            />
          ))}
        </TabsList>
      </Tabs>
      {/* The buttons share one hover highlight, indexed left to right. */}
      <Toolbar label="Case options">
        <CaseFilterMenu
          agentScoped={agentScoped}
          onChange={(patch) => onSearchChange(patch)}
          page={page}
          search={search}
          toolbarIndex={0}
        />
        <DisplayMenu
          agentScoped={agentScoped}
          onChange={(patch) => onSearchChange(patch)}
          search={search}
          toolbarIndex={1}
        />
      </Toolbar>
      <AddCaseButton agentId={agent?.id} agents={startAgents} />
    </div>
  );
  const scope = (
    <>
      <CaseEnvironmentSelect
        onChange={(env) => onSearchChange({ env })}
        value={search.env}
      />
      <SettingsSearchField
        className="w-64"
        label="Search cases"
        onChange={(q) => onSearchChange({ q })}
        placeholder="Search cases"
        value={search.q}
      />
    </>
  );
  const body = (
    <>
      <CaseFilterChips
        onChange={(patch) => onSearchChange(patch)}
        search={agentScoped ? { ...search, agent: [] } : search}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <EmptyPresence>
          {hasCases && !page.loadError ? null : (
            <CaseInboxEmpty kind={emptyKind} query={search.q} />
          )}
        </EmptyPresence>
        {hasCases ? (
          <ScrollArea
            aria-label={agentScoped ? "Cases" : undefined}
            aria-labelledby={agentScoped ? undefined : "cases-title"}
            className="min-h-0 flex-1"
            ref={scrollRef}
            viewportClassName="scroll-fade"
          >
            <ShapeProvider defaultShape="rounded">
              <CaseRows
                collapsed={collapsed}
                groups={page.groups}
                hasMore={current.nextCursor !== null}
                onLoadMore={loadMore}
                onToggleGroup={toggleGroup}
                rows={current.rows}
                scrollElement={scrollElement}
                search={search}
                showAgent={!agentScoped}
              />
            </ShapeProvider>
          </ScrollArea>
        ) : null}
      </div>
    </>
  );

  if (agent)
    return (
      <AgentPage
        actions={scope}
        agent={agent}
        fill
        tab="cases"
        trailing={toolbar}
      >
        {body}
      </AgentPage>
    );

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="case-inbox"
    >
      <PageHeader trailing={toolbar}>
        <PageTitle id="cases-title">Cases</PageTitle>
        {scope}
      </PageHeader>
      {body}
    </div>
  );
}
