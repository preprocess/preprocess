import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { spring } from "@preprocess/ui/lib/springs";
import { motion } from "motion/react";
import { memo, useEffect, useRef, useState } from "react";
import { Markdown } from "../markdown";
import type { TimelineStep, StepState } from "../types/timeline";
import { useToolComplete } from "../hooks/use-tool-complete";
import { ToolRowBase } from "./tool-row-base";
import {
  mapToolInvocationToStep,
  mapToolStateToStepState,
} from "../utils/tool-adapters";

export type ThinkingCollapsedProps = {
  step: Extract<TimelineStep, { type: "tool-call" }>;
  state: StepState;
  onComplete: () => void;
  defaultOpen?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
};

export function ThinkingCollapsed({
  step,
  state,
  onComplete,
  defaultOpen,
  expanded,
  onToggleExpand,
}: ThinkingCollapsedProps) {
  useToolComplete(state === "animating", step.duration, onComplete);

  const isControlled = expanded !== undefined;
  const [internalOpen, setInternalOpen] = useState(Boolean(defaultOpen));
  const wasAnimatingRef = useRef(state === "animating");

  useEffect(() => {
    if (isControlled) return;
    if (state === "animating") {
      setInternalOpen(true);
      wasAnimatingRef.current = true;
      return;
    }
    if (wasAnimatingRef.current) {
      wasAnimatingRef.current = false;
      setInternalOpen(false);
    }
  }, [isControlled, state]);

  const isOpen = isControlled ? expanded : internalOpen;
  const toggleExpand = isControlled
    ? onToggleExpand
    : () => setInternalOpen((open) => !open);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={spring.moderate}
    >
      <ToolRowBase
        shimmerLabel="Thinking"
        completeLabel="Thought"
        isAnimating={state === "animating"}
        expandable={!!step.thoughtContent}
        expanded={isOpen}
        onToggleExpand={toggleExpand}
      >
        {step.thoughtContent ? (
          <ScrollArea viewportClassName="scroll-fade max-h-[175px]">
            <Markdown
              content={step.thoughtContent}
              isAnimating={state === "animating"}
              className="text-muted-foreground [&_p]:text-muted-foreground [&_li]:text-muted-foreground [&_strong]:text-muted-foreground"
            />
          </ScrollArea>
        ) : null}
      </ToolRowBase>
    </motion.div>
  );
}

export type ThinkingToolProps = {
  part?: any;
  step?: Extract<TimelineStep, { type: "tool-call" }>;
  state?: StepState;
  onComplete?: () => void;
  defaultOpen?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
};

export const ThinkingTool = memo(function ThinkingTool({
  part,
  step: externalStep,
  state: externalState,
  onComplete: externalOnComplete,
  defaultOpen,
  expanded,
  onToggleExpand,
}: ThinkingToolProps) {
  let step: Extract<TimelineStep, { type: "tool-call" }>;
  let stepState: StepState;
  let onComplete: () => void;

  if (externalStep && externalState && externalOnComplete) {
    step = externalStep;
    stepState = externalState;
    onComplete = externalOnComplete;
  } else if (part?.type === "reasoning") {
    const text = typeof part.text === "string" ? part.text : "";
    if (!text.trim() && part.state !== "streaming") return null;
    step = {
      id: typeof part.id === "string" ? part.id : "reasoning",
      type: "tool-call",
      toolName: "Thinking",
      toolDetail: "",
      toolVariant: "thinking",
      thoughtContent: text,
      duration: 0,
    };
    stepState = part.state === "streaming" ? "animating" : "complete";
    onComplete = () => {};
  } else if (part) {
    step = mapToolInvocationToStep(part.toolCallId ?? part.id ?? "thinking", {
      toolName: "Thinking",
      args: part.input ?? part.args ?? {},
      state:
        part.state === "output-available"
          ? "result"
          : part.state === "input-streaming"
            ? "partial-call"
            : "call",
      result: part.output ?? part.result,
    });
    stepState = mapToolStateToStepState(
      part.state === "output-available"
        ? "result"
        : part.state === "input-streaming"
          ? "partial-call"
          : "call",
    );
    onComplete = () => {};
  } else {
    return null;
  }

  return (
    <ThinkingCollapsed
      step={step}
      state={stepState}
      onComplete={onComplete}
      defaultOpen={defaultOpen}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
    />
  );
});
