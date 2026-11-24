import { Elevated } from "@preprocess/ui/lib/elevated";
import { memo } from "react";

import { useToolComplete } from "../hooks/use-tool-complete";
import { TextShimmer } from "../text-shimmer";
import type { TimelineStep, StepState } from "../types/timeline";
import {
  mapToolInvocationToStep,
  mapToolStateToStepState,
} from "../utils/tool-adapters";
import { ToolApprovalFooter, type ToolApproval } from "./tool-approval-footer";

function extractCommandSummary(cmd: string): string {
  return cmd
    .split("|")
    .map((s) => s.trim().split(/\s+/)[0] ?? "")
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
}

export type BashToolTerminalCardProps = {
  step: Extract<TimelineStep, { type: "tool-call" }>;
  state: StepState;
  onComplete: () => void;
  approval?: ToolApproval;
};

export function BashToolTerminalCard({
  step,
  state,
  onComplete,
  approval,
}: BashToolTerminalCardProps) {
  useToolComplete(state === "animating", step.duration, onComplete);
  const isPending = state === "animating";
  const command = step.bashCommand ?? step.toolDetail;
  const summary = extractCommandSummary(command);

  return (
    <Elevated
      offset={2}
      className="overflow-hidden rounded-an-tool-border-radius"
    >
      <div className="flex h-7 items-center justify-between pl-2.5 pr-2">
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {isPending ? (
            <TextShimmer
              as="span"
              duration={1.2}
              className="m-0 inline-flex h-full items-center truncate text-caption leading-none"
            >
              Running command: {summary}
            </TextShimmer>
          ) : (
            <span className="truncate text-caption text-muted-foreground">
              Ran command: {summary}
            </span>
          )}
        </div>
        {isPending && (
          <svg
            className="size-3 shrink-0 animate-spin text-muted-foreground"
            viewBox="0 0 16 16"
            fill="none"
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="28"
              strokeDashoffset="7"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>
      <div className="overflow-hidden border-t border-border bg-background px-2.5 py-1.5 font-mono text-caption leading-[16px]">
        <div className="break-all">
          <span className="select-none text-amber-600 dark:text-amber-400">
            ${" "}
          </span>
          <span className="text-foreground">{command}</span>
        </div>
        {!isPending && step.bashOutput && (
          <div className="mt-1 max-h-[80px] overflow-hidden whitespace-pre-line text-muted-foreground">
            {step.bashOutput}
          </div>
        )}
      </div>
      {approval && <ToolApprovalFooter isPending={isPending} {...approval} />}
    </Elevated>
  );
}

export type BashToolProps = {
  part: any;
};

export const BashTool = memo(function BashTool({ part }: BashToolProps) {
  const approval = (part.input?.approval ?? part.args?.approval) as
    ToolApproval | undefined;
  const step = mapToolInvocationToStep(part.toolCallId ?? part.id ?? "bash", {
    toolName: "Bash",
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
  const noop = () => {};

  return (
    <BashToolTerminalCard
      step={step}
      state={stepState}
      onComplete={noop}
      approval={approval}
    />
  );
});
