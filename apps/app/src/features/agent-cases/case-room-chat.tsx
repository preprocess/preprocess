"use client";

import { ChatMessage } from "@preprocess/ui/components/chat-message";
import { InputMessage } from "@preprocess/ui/components/input-message";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { ThinkingIndicator } from "@preprocess/ui/components/thinking-indicator";
import {
  ThinkingStep,
  ThinkingStepDetails,
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader,
} from "@preprocess/ui/components/thinking-steps";
import type { IconName } from "@preprocess/ui/lib/icon-context";
import { cn } from "@preprocess/ui/lib/utils";
import type { UIMessage } from "ai";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Markdown } from "../../components/agent-elements/markdown";
import { currentScenario } from "../../scenarios/current-scenario";
import { caseRoomTranscript, seededReply } from "./case-room-transcripts";

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
export function CaseRoomChat({ className }: Readonly<{ className?: string }>) {
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
