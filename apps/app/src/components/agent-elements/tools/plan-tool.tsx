import { Button } from "@preprocess/ui/components/button";
import { Elevated } from "@preprocess/ui/lib/elevated";
import {
  IconChevronsDown,
  IconChevronsUp,
  IconFileDescription,
} from "@tabler/icons-react";
import { memo, useState } from "react";

import { IconSpinner } from "../icons";
import { Markdown } from "../markdown";
import { cn } from "../utils/cn";
import { areToolPropsEqual, getToolStatus } from "../utils/format-tool";

export type Plan = {
  id?: string;
  title: string;
  summary?: string;
};

export type PlanToolProps = {
  part: {
    type: string;
    toolCallId?: string;
    state?: string;
    input?: {
      plan?: Plan;
      onApprove?: () => void;
      approveLabel?: string;
      approved?: boolean;
    };
  };
  chatStatus?: string;
};

function getPlanFileName(plan: Plan) {
  const rawId = plan.id?.trim();
  if (!rawId) return "plan-working.md";
  if (rawId.endsWith(".md")) return rawId;
  return `plan-${rawId}.md`;
}

export const PlanTool = memo(function PlanTool({
  part,
  chatStatus,
}: PlanToolProps) {
  const { isPending } = getToolStatus(part, chatStatus);
  const plan = part.input?.plan;
  const [isExpanded, setIsExpanded] = useState(false);
  const [isApproved, setIsApproved] = useState(false);

  if (!plan) return null;

  const fileName = getPlanFileName(plan);
  const summary = plan.summary?.trim() ?? "";
  const hasSummary = summary.length > 0;

  const approveLabel = part.input?.approveLabel ?? "Approve";
  const isAlreadyApproved = part.input?.approved || isApproved;
  const approveText = isAlreadyApproved ? "Approved" : approveLabel;

  const handleApprove = () => {
    if (isAlreadyApproved) return;
    setIsApproved(true);
    if (typeof part.input?.onApprove === "function") {
      part.input.onApprove();
    }
  };

  return (
    <Elevated
      offset={2}
      className="an-tool-plan overflow-hidden rounded-an-tool-border-radius"
    >
      <div className="flex h-7 items-center justify-between pl-3 pr-2.5">
        <div className="min-w-0 flex items-center gap-1">
          {isPending ? (
            <IconSpinner className="w-3 h-3 text-an-tool-color-muted animate-spin shrink-0" />
          ) : (
            <IconFileDescription className="w-3.5 h-3.5 text-an-tool-color-muted shrink-0" />
          )}
          <span className="text-caption text-an-tool-color-muted truncate">
            {fileName}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-compact"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-label={isExpanded ? "Collapse plan" : "Expand plan"}
          className="size-5 text-an-tool-color-muted [&_svg]:size-3.5"
        >
          {isExpanded ? <IconChevronsUp /> : <IconChevronsDown />}
        </Button>
      </div>

      <div className="border-t border-border bg-background pt-2">
        <div className="space-y-1.5">
          <div className="text-body text-an-tool-color px-3">{plan.title}</div>

          {hasSummary ? (
            <div className="relative">
              <div
                className={cn(
                  "px-3",
                  "text-body text-an-tool-color-muted",
                  !isExpanded && "max-h-[94px] overflow-hidden",
                )}
              >
                <Markdown content={summary} className="text-body" />
              </div>

              {!isExpanded && (
                <div className="absolute inset-x-0 bottom-0 h-16 pb-2 pl-3.5 pr-2">
                  <div className="absolute inset-x-0 bottom-0 h-full w-full bg-linear-to-b from-transparent from-0% to-background to-50%" />
                  <div className="h-full flex items-end justify-between relative">
                    <Button
                      type="button"
                      variant="ghost"
                      size="compact"
                      onClick={() => setIsExpanded(true)}
                      className="-mx-2 h-5 px-1.5 text-caption hover:text-an-tool-color"
                    >
                      Read detailed plan
                    </Button>
                    {!isAlreadyApproved && (
                      <Button
                        type="button"
                        variant="primary"
                        size="compact"
                        onClick={handleApprove}
                        className="h-5 px-1.5 text-caption font-medium"
                      >
                        {approveText}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-caption text-an-tool-color-muted">
              No plan summary provided.
            </div>
          )}
        </div>

        {(isExpanded || !hasSummary) && (
          <div className="mt-2 flex items-center justify-between border-t border-border pt-1.5 pb-2 pl-3.5 pr-2">
            <Button
              type="button"
              variant="ghost"
              size="compact"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="-mx-2 h-5 px-1.5 text-caption hover:text-an-tool-color"
            >
              {isExpanded ? "Hide detailed plan" : "Read detailed plan"}
            </Button>
            {!isAlreadyApproved && (
              <Button
                type="button"
                variant="primary"
                size="compact"
                onClick={handleApprove}
                className="h-5 px-1.5 text-caption font-medium"
              >
                {approveText}
              </Button>
            )}
          </div>
        )}
      </div>
    </Elevated>
  );
}, areToolPropsEqual);
