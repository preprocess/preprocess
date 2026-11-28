import { Button } from "@preprocess/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyPresence,
  EmptyTitle,
} from "@preprocess/ui/components/empty";
import { FluidHoverHighlight } from "@preprocess/ui/components/fluid-hover-highlight";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@preprocess/ui/hooks/use-fluid-hover";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { ShapeProvider, useShape } from "@preprocess/ui/lib/shape-context";
import { cn } from "@preprocess/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, type ReactNode } from "react";

import { AgentsArt, NoResultsArt } from "../../components/empty-art";
import { PageHeader, PageTitle } from "../../components/page-header";
import { useHotkeys } from "../../components/use-hotkeys";
import { SettingsSearchField } from "../settings/kit";
import { selectAgents, type AgentListSearch } from "./agent-list-search";
import { shortDeploymentId } from "./agent-store";
import type { OrgAgent } from "./list-org-agents";

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
          Deploys production from {agent.productionBranch}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end tabular-nums">
        <span className="text-body text-foreground">
          {agent.productionDeploymentId
            ? shortDeploymentId(agent.productionDeploymentId)
            : "—"}
        </span>
        <span className="text-caption text-muted-foreground">
          {agent.productionDeploymentId ? "Production" : "Not deployed"}
        </span>
      </span>
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

/** Every agent in the organization, with its production deployment. */
export function AgentList({
  agents,
  search,
  onSearchChange,
  actions,
}: Readonly<{
  agents: readonly OrgAgent[];
  /** Page actions at the header's end, such as Add case. */
  actions?: ReactNode;
  search: AgentListSearch;
  onSearchChange: (patch: Partial<AgentListSearch>) => void;
}>) {
  const shown = selectAgents(agents, search);

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="agent-list"
    >
      <PageHeader trailing={actions}>
        <PageTitle id="agents-title">Agents</PageTitle>
        <SettingsSearchField
          className="w-64"
          label="Search agents"
          onChange={(q) => onSearchChange({ q })}
          placeholder="Search agents"
          value={search.q}
        />
      </PageHeader>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <EmptyPresence>
          {shown.length > 0 ? null : (
            <Empty
              className="pointer-events-none absolute inset-0 z-[1] border-0 p-0"
              key={agents.length === 0 ? "empty" : "no-match"}
            >
              <EmptyHeader className="pointer-events-auto group max-w-md">
                <EmptyMedia variant="graphic">
                  {agents.length === 0 ? <AgentsArt /> : <NoResultsArt />}
                </EmptyMedia>
                <EmptyTitle>
                  {agents.length === 0 ? "No agents yet" : "No matching agents"}
                </EmptyTitle>
                <EmptyDescription>
                  {agents.length === 0
                    ? "Deploy your first agent with the CLI or GitHub to see it here."
                    : "No agents match your search. Try a different name or clear the filter."}
                </EmptyDescription>
              </EmptyHeader>
              {agents.length === 0 ? null : (
                <EmptyContent className="pointer-events-auto">
                  <Button
                    onClick={() => onSearchChange({ q: "" })}
                    size="sm"
                    variant="secondary"
                  >
                    Clear search
                  </Button>
                </EmptyContent>
              )}
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
