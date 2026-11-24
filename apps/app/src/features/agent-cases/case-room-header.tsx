import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@preprocess/ui/components/breadcrumb";
import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { Tooltip } from "@preprocess/ui/components/tooltip";
import { ChevronLeftIcon, ChevronRightIcon } from "@preprocess/ui/lib/icons";
import { Link, useNavigate } from "@tanstack/react-router";

import { PageHeader } from "../../components/page-header";
import { ShortcutTooltipLabel } from "../../components/shortcut-tooltip-label";
import { useHotkeys } from "../../components/use-hotkeys";
import type { AgentCaseRef } from "./agent-case-ref";
import { caseTitle, type Case, type CaseStatus } from "./case";
import { casesSearchForUrl, rememberedCasesSearch } from "./case-inbox-search";
import { CaseStatusIcon, caseStatusColor } from "./case-status-icon";
import type { CaseNeighbors } from "./list-org-cases";
import { AssigneeStack, NeedsAssignmentTag } from "./assignee-stack";
import type { AgentSummary } from "../agents/agent-store";

function CaseStepper({ neighbors }: Readonly<{ neighbors: CaseNeighbors }>) {
  const navigate = useNavigate();
  const go = (target: Case | null) => {
    if (!target) return;
    void navigate({
      to: "/cases/$agentId/$caseId",
      params: { agentId: target.agentId, caseId: target.id },
    });
  };

  useHotkeys({
    k: () => go(neighbors.prev),
    j: () => go(neighbors.next),
    ArrowLeft: () => go(neighbors.prev),
    ArrowRight: () => go(neighbors.next),
  });

  return (
    <div className="flex items-center gap-0.5">
      <Tooltip
        content={<ShortcutTooltipLabel keys={["←"]} label="Previous case" />}
        side="bottom"
      >
        <Button
          aria-label="Previous case"
          disabled={!neighbors.prev}
          onClick={() => go(neighbors.prev)}
          size="icon-compact"
          type="button"
          variant="ghost"
        >
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip
        content={<ShortcutTooltipLabel keys={["→"]} label="Next case" />}
        side="bottom"
      >
        <Button
          aria-label="Next case"
          disabled={!neighbors.next}
          onClick={() => go(neighbors.next)}
          size="icon-compact"
          type="button"
          variant="ghost"
        >
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  );
}

export function CaseRoomHeader({
  agent,
  caseRef,
  caseItem,
  neighbors,
  onStatusChange,
}: Readonly<{
  agent: AgentSummary | null;
  caseRef: AgentCaseRef;
  caseItem: Case | null;
  neighbors?: CaseNeighbors;
  onStatusChange?: (status: CaseStatus) => Promise<unknown>;
}>) {
  const navigate = useNavigate();
  const listSearch = casesSearchForUrl(rememberedCasesSearch());
  const done = caseItem?.status === "Done";

  useHotkeys({
    Escape: () => void navigate({ to: "/cases", search: listSearch }),
  });

  return (
    <PageHeader
      trailing={
        <>
          {caseItem && caseItem.assignees.length > 0 ? (
            <AssigneeStack assignees={caseItem.assignees} className="mr-1" />
          ) : null}
          {neighbors && neighbors.index > 0 ? (
            <CaseStepper neighbors={neighbors} />
          ) : null}
          {caseItem && onStatusChange ? (
            <LoadingButton
              onAction={() => onStatusChange(done ? "Active" : "Done")}
              pendingLabel={done ? "Reopening" : "Completing"}
              size="compact"
              successLabel={done ? "Reopened" : "Completed"}
              variant={done ? "secondary" : "primary"}
            >
              {done ? "Reopen" : "Mark complete"}
            </LoadingButton>
          ) : null}
        </>
      }
    >
      <Breadcrumb className="flex min-w-0 items-center">
        <BreadcrumbList className="min-w-0 flex-nowrap">
          <BreadcrumbItem className="shrink-0">
            <BreadcrumbLink render={<Link search={listSearch} to="/cases" />}>
              Cases
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator>/</BreadcrumbSeparator>
          <BreadcrumbItem className="shrink-0">
            <BreadcrumbLink
              render={
                <Link search={{ agent: [caseRef.agentId] }} to="/cases" />
              }
            >
              {agent?.name ?? caseRef.agentId}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator>/</BreadcrumbSeparator>
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">
              {caseItem ? caseTitle(caseItem) : caseRef.caseId}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {caseItem ? (
        <Badge
          className="shrink-0"
          color={caseStatusColor(caseItem.status)}
          size="sm"
        >
          <span className="flex items-center gap-1">
            <CaseStatusIcon status={caseItem.status} />
            {caseItem.status}
          </span>
        </Badge>
      ) : null}
      {caseItem ? <NeedsAssignmentTag item={caseItem} /> : null}
    </PageHeader>
  );
}
