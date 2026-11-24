import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyPresence,
  EmptyTitle,
} from "@preprocess/ui/components/empty";
import { Badge, type BadgeColor } from "@preprocess/ui/components/badge";
import {
  DropdownContent,
  DropdownLabel,
  DropdownMenu,
  DropdownTrigger,
} from "@preprocess/ui/components/dropdown";
import { FluidHoverHighlight } from "@preprocess/ui/components/fluid-hover-highlight";
import { MenuItem } from "@preprocess/ui/components/menu-item";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { Tooltip } from "@preprocess/ui/components/tooltip";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@preprocess/ui/hooks/use-fluid-hover";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import type { IconComponent } from "@preprocess/ui/lib/icon-context";
import {
  Eye,
  Folder4,
  Pencil,
  SlidersHorizontal,
  Users,
} from "@preprocess/ui/lib/icons";
import { ShapeProvider, useShape } from "@preprocess/ui/lib/shape-context";
import { cn } from "@preprocess/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  forwardRef,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { NoMatchArt, RobotArt } from "../../components/empty-art";
import { FilterChips, FilterMenu } from "../../components/list-controls";
import { PageHeader, PageTitle } from "../../components/page-header";
import { Toolbar, ToolbarButton } from "../../components/toolbar";
import { useHotkeys } from "../../components/use-hotkeys";
import {
  CASE_STATUSES,
  formatCost,
  type CaseStatus,
} from "../agent-cases/case";
import {
  CASE_STATUS_MENU_ICON,
  CaseStatusIcon,
} from "../agent-cases/case-status-icon";
import { SettingsSearchField } from "../settings/kit";
import {
  AGENT_SORTS,
  AGENT_SORT_LABEL,
  DEFAULT_AGENT_SEARCH,
  agentGroups,
  agentReachableBy,
  selectAgents,
  type AgentListSearch,
} from "./agent-list-search";
import type { AgentAccessLevel, AgentGrant } from "./agent-seed";
import { shortDeploymentId } from "./agent-store";
import type { OrgAgent } from "./list-org-agents";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const countFormat = new Intl.NumberFormat();

/** Group badges a row shows before folding the rest into "+N". */
const GRANTS_VISIBLE = 2;

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

/** Operators read as blue with a pencil (they act); viewers as neutral
 *  gray with an eye (they look). */
const LEVEL: Record<
  AgentAccessLevel,
  { label: string; color: BadgeColor; icon: IconComponent }
> = {
  operator: { label: "Operator", color: "blue", icon: Pencil },
  viewer: { label: "Viewer", color: "gray", icon: Eye },
};

function grantLabel(grant: AgentGrant) {
  return `${grant.group} · ${LEVEL[grant.level].label}`;
}

/**
 * A row's two-line cell: a value over a muted caption. Forwards its ref and
 * props so a Tooltip can use it as the trigger.
 */
const Stat = forwardRef<
  HTMLSpanElement,
  Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
    value: ReactNode;
    caption: ReactNode;
  }
>(function Stat({ value, caption, className, ...props }, ref) {
  return (
    <span
      className={cn("flex shrink-0 flex-col items-end tabular-nums", className)}
      ref={ref}
      {...props}
    >
      <span className="text-body text-foreground">{value}</span>
      <span className="text-caption text-muted-foreground">{caption}</span>
    </span>
  );
});

/** Groups with access: operators as plain badges, viewers with an eye. */
function AccessGroups({ access }: Readonly<{ access: readonly AgentGrant[] }>) {
  if (access.length === 0) {
    return (
      <span className="text-caption text-muted-foreground">No access</span>
    );
  }
  const shown = access.slice(0, GRANTS_VISIBLE);
  const hidden = access.slice(GRANTS_VISIBLE);
  return (
    <span className="flex min-w-0 items-center justify-end gap-1">
      {shown.map((grant) => {
        const { color, icon: Icon } = LEVEL[grant.level];
        return (
          <Tooltip content={grantLabel(grant)} key={grant.group} side="top">
            <Badge
              aria-label={grantLabel(grant)}
              className="shrink-0"
              color={color}
              size="sm"
            >
              <span className="flex items-center gap-1">
                <Icon aria-hidden="true" className="size-3" />
                {grant.group}
              </span>
            </Badge>
          </Tooltip>
        );
      })}
      {hidden.length > 0 ? (
        <Tooltip content={hidden.map(grantLabel).join(", ")} side="top">
          <Badge className="shrink-0" size="sm">
            +{hidden.length}
          </Badge>
        </Tooltip>
      ) : null}
    </span>
  );
}

function StatusCount({
  status,
  count,
}: Readonly<{ status: CaseStatus; count: number }>) {
  const label = `${countFormat.format(count)} ${status.toLowerCase()}`;
  return (
    <Tooltip content={label} side="top">
      <span
        aria-label={label}
        className={cn(
          "flex w-14 shrink-0 items-center gap-1.5 text-caption tabular-nums",
          count === 0 ? "text-muted-foreground" : "text-foreground",
        )}
      >
        <CaseStatusIcon status={status} />
        {countFormat.format(count)}
      </span>
    </Tooltip>
  );
}

function AgentRow({
  agent,
  index,
  registerItem,
}: Readonly<{
  agent: OrgAgent;
  index: number;
  registerItem: (index: number, element: HTMLElement | null) => void;
}>) {
  const ref = useRef<HTMLAnchorElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  const shape = useShape();
  const { stats } = agent;
  const average =
    stats.total > 0 ? Math.round(stats.costCents / stats.total) : 0;

  return (
    <Link
      className={cn(
        "relative flex h-14 min-w-0 items-center gap-4 px-3 outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring)",
        shape.item,
      )}
      data-agent-row={index}
      params={{ agentId: agent.id }}
      ref={ref}
      to="/agents/$agentId"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate text-body text-foreground"
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {agent.name}
        </span>
        <span className="truncate text-caption text-muted-foreground">
          {agent.description}
        </span>
      </span>
      <span className="hidden w-52 shrink-0 lg:flex lg:justify-end">
        <AccessGroups
          access={
            agent.everyone
              ? [{ group: "Everyone", level: agent.everyone }, ...agent.access]
              : agent.access
          }
        />
      </span>
      <span className="hidden items-center md:flex">
        {CASE_STATUSES.map((status) => (
          <StatusCount
            count={stats.byStatus[status]}
            key={status}
            status={status}
          />
        ))}
      </span>
      <Tooltip
        content={`${formatCost(stats.costCents)} across ${countFormat.format(stats.total)} cases`}
        side="top"
      >
        <Stat
          caption={`${formatCost(average)} avg`}
          className="w-20"
          value={formatCost(stats.costCents)}
        />
      </Tooltip>
      <Tooltip content={`Deployed ${formatDate(agent.deployedAt)}`} side="top">
        <Stat
          caption={formatDate(agent.deployedAt)}
          className="w-14"
          value={
            agent.deploymentId ? shortDeploymentId(agent.deploymentId) : "—"
          }
        />
      </Tooltip>
    </Link>
  );
}

function AgentRows({ agents }: Readonly<{ agents: readonly OrgAgent[] }>) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(containerRef);
  const { activeIndex, setActiveIndex } = hover;
  const shape = useShape();

  const moveActive = (delta: number) => {
    if (agents.length === 0) return;
    const next =
      activeIndex === null
        ? 0
        : Math.min(Math.max(activeIndex + delta, 0), agents.length - 1);
    setActiveIndex(next);
    containerRef.current
      ?.querySelector(`[data-agent-row="${next}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const openActive = () => {
    const agent = activeIndex === null ? undefined : agents[activeIndex];
    if (!agent) return;
    void navigate({ to: "/agents/$agentId", params: { agentId: agent.id } });
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
      className="relative flex flex-col gap-1 px-2 py-2"
      onMouseEnter={hover.handlers.onMouseEnter}
      onMouseLeave={hover.handlers.onMouseLeave}
      onMouseMove={hover.handlers.onMouseMove}
      ref={containerRef}
    >
      <FluidHoverHighlight hover={hover} className={shape.bg} />
      {agents.map((agent, index) => (
        <AgentRow
          agent={agent}
          index={index}
          key={agent.id}
          registerItem={hover.registerItem}
        />
      ))}
    </div>
  );
}

const agentCountLabel = (count: number) =>
  `${countFormat.format(count)} ${count === 1 ? "agent" : "agents"}`;

function AgentFilterMenu({
  agents,
  search,
  onChange,
}: Readonly<{
  agents: readonly OrgAgent[];
  search: AgentListSearch;
  onChange: (patch: Partial<AgentListSearch>) => void;
}>) {
  const waitingCount = agents.filter(
    (agent) => agent.stats.byStatus.Waiting > 0,
  ).length;
  return (
    <FilterMenu
      countLabel={agentCountLabel}
      facets={[
        {
          key: "group",
          label: "Group",
          icon: Users,
          options: agentGroups(agents).map((group) => ({
            value: group,
            label: group,
            count: agents.filter((agent) => agentReachableBy(agent, group))
              .length,
          })),
          selected: search.group,
          onChange: (group) => onChange({ group }),
        },
        {
          key: "cases",
          label: "Cases",
          icon: Folder4,
          options: [
            {
              value: "waiting",
              label: "Has waiting cases",
              icon: CASE_STATUS_MENU_ICON.Waiting,
              count: waitingCount,
            },
          ],
          selected: search.waiting ? ["waiting"] : [],
          onChange: (next) => onChange({ waiting: next.includes("waiting") }),
        },
      ]}
    />
  );
}

function AgentDisplayMenu({
  search,
  onChange,
}: Readonly<{
  search: AgentListSearch;
  onChange: (patch: Partial<AgentListSearch>) => void;
}>) {
  const [open, setOpen] = useState(false);
  return (
    // Menus open at the default size, though the header's controls are compact.
    <DropdownMenu onOpenChange={setOpen} open={open} size="default">
      <Tooltip content="Display" side="bottom">
        <DropdownTrigger
          aria-label="Display options"
          render={
            <ToolbarButton
              active={open || search.sort !== DEFAULT_AGENT_SEARCH.sort}
              index={1}
            />
          }
        >
          <SlidersHorizontal aria-hidden="true" />
        </DropdownTrigger>
      </Tooltip>
      <DropdownContent
        align="end"
        checkedIndices={[AGENT_SORTS.indexOf(search.sort)]}
        className="w-48"
      >
        <DropdownLabel>Ordering</DropdownLabel>
        {AGENT_SORTS.map((sort, row) => (
          <MenuItem
            checked={search.sort === sort}
            index={row}
            key={sort}
            label={AGENT_SORT_LABEL[sort]}
            onSelect={() => onChange({ sort })}
          />
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}

/** Every agent in the organization, with its cases by status. */
export function AgentList({
  agents,
  search,
  onSearchChange,
}: Readonly<{
  agents: readonly OrgAgent[];
  search: AgentListSearch;
  onSearchChange: (patch: Partial<AgentListSearch>) => void;
}>) {
  const shown = selectAgents(agents, search);
  const filtered =
    search.q.trim() !== "" || search.group.length > 0 || search.waiting;

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="agent-list"
    >
      <PageHeader
        trailing={
          <Toolbar label="Agent list options">
            <AgentFilterMenu
              agents={agents}
              onChange={onSearchChange}
              search={search}
            />
            <AgentDisplayMenu onChange={onSearchChange} search={search} />
          </Toolbar>
        }
      >
        <PageTitle id="agents-title">Agents</PageTitle>
        <SettingsSearchField
          className="w-64"
          label="Search agents"
          onChange={(q) => onSearchChange({ q })}
          placeholder="Search agents"
          value={search.q}
        />
      </PageHeader>
      <FilterChips
        chips={[
          {
            key: "group",
            label: "Group",
            lead:
              search.group.length > 1
                ? "Accessible to one of"
                : "Accessible to",
            values: search.group.join(", "),
            onClear: () => onSearchChange({ group: [] }),
          },
          {
            key: "waiting",
            label: "Waiting",
            lead: "Has",
            values: search.waiting ? "waiting cases" : "",
            onClear: () => onSearchChange({ waiting: false }),
          },
        ]}
        onClearAll={() => onSearchChange({ group: [], waiting: false })}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <EmptyPresence>
          {shown.length > 0 ? null : (
            <Empty
              className="pointer-events-none absolute inset-0 z-[1] border-0 p-0"
              key={agents.length === 0 ? "empty" : "no-match"}
            >
              <EmptyHeader className="pointer-events-auto group max-w-md">
                <EmptyMedia variant="graphic">
                  {agents.length === 0 ? <RobotArt /> : <NoMatchArt />}
                </EmptyMedia>
                <EmptyTitle>
                  {agents.length === 0 ? "No agents yet" : "No agents match"}
                </EmptyTitle>
                <EmptyDescription>
                  {agents.length === 0
                    ? "Agents in this organization will show up here."
                    : search.q.trim() !== ""
                      ? `Nothing matches “${search.q.trim()}”.`
                      : filtered
                        ? "Nothing matches these filters."
                        : ""}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </EmptyPresence>
        {shown.length > 0 ? (
          <ScrollArea
            aria-labelledby="agents-title"
            className="min-h-0 flex-1"
            viewportClassName="scroll-fade"
          >
            <ShapeProvider defaultShape="rounded">
              <AgentRows agents={shown} />
            </ShapeProvider>
          </ScrollArea>
        ) : null}
      </div>
    </div>
  );
}
