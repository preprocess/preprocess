import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { Elevated } from "@preprocess/ui/lib/elevated";
import { IconFileText } from "@tabler/icons-react";
import { memo } from "react";

import { useToolComplete } from "../hooks/use-tool-complete";
import type { SourceType } from "../icons/source-icons";
import type { TimelineStep, StepState } from "../types/timeline";
import { cn } from "../utils/cn";
import {
  mapToolInvocationToStep,
  mapToolStateToStepState,
  textOutput,
} from "../utils/tool-adapters";
import { ToolRowBase } from "./tool-row-base";

export type SearchResult = { source: SourceType; title: string; date: string };

export type SearchGroupRichProps = {
  toolSteps: Extract<TimelineStep, { type: "tool-call" }>[];
  stepStates: Record<string, StepState>;
  onStepComplete: (id: string) => void;
  results?: SearchResult[];
  defaultOpen?: boolean;
};

export function SearchGroupRich({
  toolSteps,
  stepStates,
  onStepComplete,
  results = [],
  defaultOpen,
}: SearchGroupRichProps) {
  const anyAnimating = toolSteps.some((s) => stepStates[s.id] === "animating");
  const searchQuery =
    toolSteps.find((s) => s.searchQuery)?.searchQuery ?? "searching...";
  const totalResults = results.length;
  const toolName = toolSteps[0]?.toolName.toLowerCase();
  const resultNoun =
    toolName === "glob" ? "files" : toolName === "grep" ? "matches" : "results";
  // Only expose the expand affordance once there is something useful to show.
  // While the search is still streaming we have no results yet and the panel
  // header is just "Searched for <same query>" — redundant with the row
  // label. Once results arrive the panel becomes meaningful.
  const hasExpandableContent = totalResults > 0;

  function CompleteTracker({
    step,
  }: {
    step: Extract<TimelineStep, { type: "tool-call" }>;
  }) {
    useToolComplete(stepStates[step.id] === "animating", step.duration, () =>
      onStepComplete(step.id),
    );
    return null;
  }

  return (
    <>
      {toolSteps.map((step) => (
        <CompleteTracker key={step.id} step={step} />
      ))}
      <ToolRowBase
        shimmerLabel="Searching..."
        completeLabel={`Found ${totalResults} ${resultNoun}`}
        isAnimating={anyAnimating}
        expandable={hasExpandableContent}
        defaultOpen={defaultOpen}
      >
        <Elevated
          offset={2}
          className="overflow-hidden rounded-an-tool-border-radius"
        >
          <div className="flex h-7 items-center gap-1 border-b border-an-tool-border-color px-2.5 py-0 text-caption">
            <span className="font-medium text-foreground">Searched for</span>{" "}
            <span className="truncate text-muted-foreground">
              &ldquo;{searchQuery}&rdquo;
            </span>
          </div>
          <ScrollArea
            className="bg-background"
            viewportClassName="scroll-fade max-h-[200px]"
          >
            <div className="flex flex-col gap-1 p-1">
              {results.map((result, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex cursor-default items-center gap-2 rounded-[calc(var(--an-tool-border-radius)-4px)] px-2 py-1",
                    "hover:bg-muted/50",
                  )}
                >
                  <div className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                    <IconFileText className="size-4" />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-body text-foreground/90">
                    {result.title}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-caption text-muted-foreground">
                    {result.date || result.source}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Elevated>
      </ToolRowBase>
    </>
  );
}

export type SearchToolProps = {
  part: {
    id?: string;
    toolCallId?: string;
    type?: string;
    toolName?: string;
    state?: string;
    input?: Record<string, unknown>;
    args?: Record<string, unknown>;
    output?: unknown;
    result?: unknown;
  };
  results?: SearchResult[];
  defaultOpen?: boolean;
};

function normalizeResults(value: unknown): SearchResult[] | undefined {
  if (Array.isArray(value)) {
    const parsed = value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const source = (item as { source?: unknown }).source;
        const title = (item as { title?: unknown }).title;
        const date = (item as { date?: unknown }).date;
        if (typeof title !== "string") return null;
        return {
          source: (typeof source === "string" ? source : "web") as SourceType,
          title,
          date: typeof date === "string" ? date : "",
        };
      })
      .filter((item): item is SearchResult => Boolean(item));
    return parsed.length > 0 ? parsed : undefined;
  }

  const text = textOutput(value);
  if (!text) return undefined;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;

  return lines.map((line) => {
    const match = /^(.+?):(\d+):(.*)$/.exec(line);
    if (match) {
      const filePath = match[1] ?? line;
      return {
        source: "web" as const,
        title: filePath.split("/").pop() || filePath,
        date: `${match[2]}: ${match[3]}`.trim(),
      };
    }
    return {
      source: "web" as const,
      title: line.split("/").pop() || line,
      date: line,
    };
  });
}

export const SearchTool = memo(function SearchTool({
  part,
  results,
  defaultOpen,
}: SearchToolProps) {
  const step = mapToolInvocationToStep(part.toolCallId ?? part.id ?? "search", {
    toolName:
      (typeof part.toolName === "string" && part.toolName) ||
      part.type?.replace("tool-", "") ||
      "WebSearch",
    args: part.input ?? part.args ?? {},
    state:
      part.state === "output-available"
        ? "result"
        : part.state === "input-streaming"
          ? "partial-call"
          : "call",
    result: part.output ?? part.result,
  });
  const stepState = mapToolStateToStepState(
    part.state === "output-available"
      ? "result"
      : part.state === "input-streaming"
        ? "partial-call"
        : "call",
  );
  const stepStates = { [step.id]: stepState };
  const noop = () => {};

  return (
    <SearchGroupRich
      toolSteps={[step]}
      stepStates={stepStates}
      onStepComplete={noop}
      results={
        results ??
        normalizeResults(
          part.output &&
            typeof part.output === "object" &&
            "results" in part.output
            ? part.output.results
            : part.output,
        ) ??
        normalizeResults(
          part.result &&
            typeof part.result === "object" &&
            "results" in part.result
            ? part.result.results
            : part.result,
        )
      }
      defaultOpen={defaultOpen}
    />
  );
});
