import { Button } from "@preprocess/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@preprocess/ui/components/empty";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

import {
  CouldntLoadArt,
  NoResultsArt,
  NothingCreatedArt,
} from "../../components/empty-art";

export type CaseInboxEmptyKind = "unavailable" | "empty" | "no-match";

export function CaseInboxEmpty({
  kind,
  agentScoped = false,
  onClearFilters,
}: {
  kind: CaseInboxEmptyKind;
  agentScoped?: boolean;
  onClearFilters: () => void;
}) {
  const router = useRouter();
  let art: ReactNode;
  let title: string;
  let description: string;
  let action: ReactNode = null;
  switch (kind) {
    case "unavailable":
      art = <CouldntLoadArt />;
      title = "Couldn't load cases";
      description = "Something went wrong loading your cases. Try again.";
      action = (
        <Button
          onClick={() => void router.invalidate()}
          size="sm"
          variant="secondary"
        >
          Try again
        </Button>
      );
      break;
    case "empty":
      art = <NothingCreatedArt />;
      title = agentScoped ? "No cases for this agent" : "No cases yet";
      description = agentScoped
        ? "Cases started for this agent show up here."
        : "Start a case from an agent, the API, a schedule or MCP to see it here.";
      break;
    case "no-match":
      art = <NoResultsArt />;
      title = "No matching cases";
      description = agentScoped
        ? "No cases for this agent match these filters."
        : "No cases match these filters. Adjust your search or clear filters.";
      action = (
        <Button onClick={onClearFilters} size="sm" variant="secondary">
          Clear filters
        </Button>
      );
      break;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }

  return (
    <Empty
      className="pointer-events-none absolute inset-0 z-[1] border-0 p-0"
      role={kind === "unavailable" ? "alert" : undefined}
    >
      <EmptyHeader className="pointer-events-auto group max-w-md">
        <EmptyMedia variant="graphic">{art}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? (
        <EmptyContent className="pointer-events-auto">{action}</EmptyContent>
      ) : null}
    </Empty>
  );
}
