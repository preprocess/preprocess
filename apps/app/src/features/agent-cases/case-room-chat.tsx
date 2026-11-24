"use client";

import { Button } from "@preprocess/ui/components/button";
import { ChatMessage } from "@preprocess/ui/components/chat-message";
import { InputMessage } from "@preprocess/ui/components/input-message";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { ThinkingIndicator } from "@preprocess/ui/components/thinking-indicator";
import {
  ThinkingStep,
  ThinkingStepDetails,
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader,
} from "@preprocess/ui/components/thinking-steps";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import type { IconName } from "@preprocess/ui/lib/icon-context";
import { Brain } from "@preprocess/ui/lib/icons";
import { cn } from "@preprocess/ui/lib/utils";
import type { UIMessage } from "ai";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Markdown } from "../../components/agent-elements/markdown";
import { approveAgentMemory } from "../agents/agent-memories";
import { currentScenario } from "../../scenarios/current-scenario";
import { caseRoomTranscript, seededReply } from "./case-room-transcripts";

/** What the seeded transcript's agent proposes to remember. */
const PROPOSED_MEMORY =
  "When a renewal pack has no signed exhibit B, ask Legal before extracting terms.";

/**
 * A memory the agent proposes from feedback in this chat. Approving it saves
 * it for every future case on the agent; memories are only approved here.
 */
function ProposedMemory({
  agentId,
  caseLabel,
}: Readonly<{ agentId: string; caseLabel: string }>) {
  const [state, setState] = useState<"proposed" | "approved" | "dismissed">(
    "proposed",
  );
  if (state === "dismissed") return null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-muted px-4 py-3">
      <div className="flex items-center gap-2 text-caption text-muted-foreground">
        <Brain aria-hidden="true" className="size-3.5" />
        {state === "approved"
          ? "Saved to this agent's memories"
          : "Remember this for future cases?"}
      </div>
      <p
        className="text-body text-foreground"
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {PROPOSED_MEMORY}
      </p>
      {state === "proposed" ? (
        <div className="flex items-center gap-2">
          <LoadingButton
            onAction={async () => {
              await approveAgentMemory(agentId, PROPOSED_MEMORY, caseLabel);
              window.setTimeout(() => setState("approved"), 500);
            }}
            pendingLabel="Saving…"
            size="compact"
            successLabel="Saved"
          >
            Approve
          </LoadingButton>
          <Button
            onClick={() => setState("dismissed")}
            size="compact"
            type="button"
            variant="ghost"
          >
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const REPLY_DELAY_MS = 700;
/** Output lines a tool step shows before the rest folds away. */
const TOOL_OUTPUT_LINES = 6;

type Part = UIMessage["parts"][number];

type Step = {
  readonly key: string;
  readonly icon: IconName;
  readonly label: string;
  readonly description?: string;
  readonly output?: readonly string[];
};

const TOOL_ICON: Record<string, IconName> = {
  bash: "monitor",
  read: "folder",
  search: "search",
  edit: "pencil",
};

function toolStep(part: Part, index: number): Step | null {
  if (part.type === "reasoning") {
    return {
      key: `r${index}`,
      icon: "brain",
      label: "Thought",
      description: part.text,
    };
  }
  if (part.type !== "dynamic-tool") return null;
  const input =
    typeof part.input === "object" && part.input !== null
      ? (part.input as Record<string, unknown>)
      : {};
  const target = [input.command, input.file_path, input.query].find(
    (value): value is string => typeof value === "string",
  );
  const output =
    part.state === "output-available" && typeof part.output === "string"
      ? part.output.trimEnd().split("\n")
      : undefined;
  return {
    key: part.toolCallId,
    icon: TOOL_ICON[part.toolName] ?? "settings",
    label: part.toolName === "bash" ? "Ran a command" : `Used ${part.toolName}`,
    description: target,
    output,
  };
}

function textOf(message: UIMessage) {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");
}

function AssistantMessage({ message }: Readonly<{ message: UIMessage }>) {
  const steps = message.parts.flatMap((part, index) => {
    const step = toolStep(part, index);
    return step ? [step] : [];
  });
  const text = textOf(message);

  return (
    <div className="flex flex-col gap-2 self-stretch">
      {steps.length > 0 ? (
        <ThinkingSteps className="w-full" defaultOpen={false}>
          <ThinkingStepsHeader>
            {steps.length === 1 ? "1 step" : `${steps.length} steps`}
          </ThinkingStepsHeader>
          <ThinkingStepsContent>
            {steps.map((step, index) => (
              <ThinkingStep
                description={step.description}
                icon={step.icon}
                isLast={index === steps.length - 1}
                key={step.key}
                label={step.label}
              >
                {step.output && step.output.length > 0 ? (
                  <ThinkingStepDetails
                    details={step.output.slice(0, TOOL_OUTPUT_LINES)}
                    summary={
                      step.output.length === 1
                        ? "1 line of output"
                        : `${step.output.length} lines of output`
                    }
                  />
                ) : null}
              </ThinkingStep>
            ))}
          </ThinkingStepsContent>
        </ThinkingSteps>
      ) : null}
      {text ? (
        // The bubble keeps pre-wrapped text; markdown lays out its own blocks.
        <ChatMessage
          className="max-w-full [&>div:first-child]:whitespace-normal"
          from="assistant"
        >
          <Markdown content={text} />
        </ChatMessage>
      ) : null}
    </div>
  );
}

/**
 * The case room chat on Fluid's chat parts over a seeded transcript.
 * Sending appends the message and a canned reply, so the composer's
 * streaming and stop states stay exercisable. There is no agent runtime yet.
 */
export function CaseRoomChat({
  agentId,
  caseLabel,
  className,
}: Readonly<{ agentId: string; caseLabel: string; className?: string }>) {
  const [transcript] = useState(() =>
    caseRoomTranscript(currentScenario()["case-room"]),
  );
  const [messages, setMessages] = useState<UIMessage[]>(() => [
    ...transcript.messages,
  ]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(transcript.streaming);
  const replyTimer = useRef<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => window.clearTimeout(replyTimer.current), []);

  // Keep the newest message in view as the transcript grows.
  useLayoutEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>(
      "[data-slot='scroll-area-viewport']",
    );
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [messages.length, streaming]);

  const send = (value: string) => {
    const text = value.trim();
    if (!text) return;
    const id = `msg_local_${Date.now()}`;
    setMessages((current) => [
      ...current,
      { id, role: "user", parts: [{ type: "text", text }] },
    ]);
    setDraft("");
    setStreaming(true);
    window.clearTimeout(replyTimer.current);
    replyTimer.current = window.setTimeout(() => {
      setMessages((current) => [...current, seededReply(`${id}_reply`)]);
      setStreaming(false);
    }, REPLY_DELAY_MS);
  };

  const stop = () => {
    window.clearTimeout(replyTimer.current);
    setStreaming(false);
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <ScrollArea
        className="min-h-0 flex-1"
        ref={scrollRef}
        viewportClassName="scroll-fade"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-4 pt-2">
          {messages.map((message) =>
            message.role === "user" ? (
              <ChatMessage from="user" key={message.id}>
                {textOf(message)}
              </ChatMessage>
            ) : (
              <AssistantMessage key={message.id} message={message} />
            ),
          )}
          {import.meta.env.DEV && transcript.messages.length > 0 ? (
            <ProposedMemory agentId={agentId} caseLabel={caseLabel} />
          ) : null}
          {streaming ? <ThinkingIndicator className="px-0" /> : null}
        </div>
      </ScrollArea>
      <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-3">
        <InputMessage
          onSend={(value) => send(value)}
          onStop={stop}
          onValueChange={setDraft}
          placeholder="Ask the agent about this case"
          status={streaming ? "streaming" : "idle"}
          value={draft}
        />
      </div>
    </div>
  );
}
