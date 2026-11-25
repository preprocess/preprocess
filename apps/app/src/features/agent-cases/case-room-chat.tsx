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
import type { RoomMessage } from "./case-room-state";
import { caseRoomTranscript, seededReply } from "./case-room-transcripts";
import { useCaseWork } from "./case-work-context";

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

/** Keeps the newest message in view as the thread grows. */
function useStickToBottom(...deps: readonly unknown[]) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>(
      "[data-slot='scroll-area-viewport']",
    );
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, deps);
  return scrollRef;
}

function ThreadEntry({ message }: Readonly<{ message: RoomMessage }>) {
  if (message.kind === "event")
    return (
      <span className="self-center text-caption text-muted-foreground">
        {message.text}
      </span>
    );
  if (message.kind === "input" || message.kind === "person")
    return <ChatMessage from="user">{message.text}</ChatMessage>;
  return (
    <ChatMessage
      className="max-w-full [&>div:first-child]:whitespace-normal"
      from="assistant"
    >
      <Markdown content={message.text} />
    </ChatMessage>
  );
}

/**
 * A live case's thread from GET /cases/{id}/room. Sending posts to the
 * thread and reloads the room; it doesn't wake the agent, and @group
 * mentions notify that group.
 */
function LiveCaseRoomChat({
  className,
  work,
}: Readonly<{
  className?: string;
  work: NonNullable<ReturnType<typeof useCaseWork>>;
}>) {
  const { thread } = work.room;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useStickToBottom(thread.length);

  const send = async (value: string) => {
    const text = value.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    const result = await work.actions.post(text).catch((cause: unknown) => ({
      ok: false as const,
      message:
        cause instanceof Error ? cause.message : "The message wasn't sent.",
    }));
    setSending(false);
    if (result.ok) setDraft("");
    else setError(result.message);
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <ScrollArea
        className="min-h-0 flex-1"
        ref={scrollRef}
        viewportClassName="scroll-fade"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-4 pt-2">
          {thread.map((message) => (
            <ThreadEntry key={message.id} message={message} />
          ))}
        </div>
      </ScrollArea>
      <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-1 px-3 pb-3">
        {error ? (
          <span className="px-1 text-body text-destructive" role="alert">
            {error}
          </span>
        ) : null}
        <InputMessage
          onSend={(value) => void send(value)}
          onValueChange={setDraft}
          placeholder="Write to the case thread; @mention a group to notify it"
          status="idle"
          value={draft}
        />
      </div>
    </div>
  );
}

/**
 * The case room chat. Live cases show their thread; seeded scenarios use
 * Fluid's chat parts over a seeded transcript, where sending appends the
 * message and a canned reply so the streaming and stop states stay
 * exercisable.
 */
export function CaseRoomChat({ className }: Readonly<{ className?: string }>) {
  const work = useCaseWork();
  if (work && currentScenario()["case-work"] === "live")
    return <LiveCaseRoomChat className={className} work={work} />;
  return <SeededCaseRoomChat className={className} />;
}

function SeededCaseRoomChat({ className }: Readonly<{ className?: string }>) {
  const [transcript] = useState(() =>
    caseRoomTranscript(currentScenario()["case-room"]),
  );
  const [messages, setMessages] = useState<UIMessage[]>(() => [
    ...transcript.messages,
  ]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(transcript.streaming);
  const replyTimer = useRef<number | undefined>(undefined);
  const scrollRef = useStickToBottom(messages.length, streaming);

  useEffect(() => () => window.clearTimeout(replyTimer.current), []);

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
