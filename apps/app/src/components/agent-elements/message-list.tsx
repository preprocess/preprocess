import { EmptyPresence } from "@preprocess/ui/components/empty";
import { Button } from "@preprocess/ui/components/button";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { Spinner } from "@preprocess/ui/components/spinner";
import { ArrowDownIcon, Check, Copy } from "@preprocess/ui/lib/icons";
import { spring } from "@preprocess/ui/lib/springs";
import type { UIMessage, ChatStatus } from "ai";
import { animate, type AnimationPlaybackControls } from "motion/react";
import React, {
  memo,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useState,
  useMemo,
} from "react";

import { ChatEmpty } from "../chat-empty";
import { ErrorMessage } from "./error-message";
import { Markdown } from "./markdown";
import { ThinkingTool } from "./tools/thinking-tool";
import { ToolRowBase } from "./tools/tool-row-base";
import { ToolRenderer as DefaultToolRenderer } from "./tools/tool-renderer";
import type { CustomToolRendererProps } from "./types";
import { UserMessage, type MessageSender } from "./user-message";
import { cn } from "./utils/cn";
import { normalizeAssistantToolParts } from "./utils/tool-part-normalizer";

function getScrollViewport(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  if (root.getAttribute("data-slot") === "scroll-area-viewport") return root;
  return root.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']");
}

export type MessageListProps = {
  messages: UIMessage[];
  status: ChatStatus;
  className?: string;
  showCopyToolbar?: boolean;
  suppressQuestionTool?: boolean;
  /**
   * Where to position the scroll container on initial mount.
   * - "bottom" (default): classic chat behavior, pinned to the latest message.
   * - "top": start from the top of the conversation — useful for static demos
   *   or read-only transcripts where the user should read top-to-bottom.
   */
  initialScrollBehavior?: "bottom" | "top";
  /**
   * When true (default) clicking an attached image in a user message opens
   * the fullscreen lightbox preview. Set to false to disable previews.
   */
  enableImagePreview?: boolean;
  /** Signed-in sender shown on user turns. */
  sender?: MessageSender;
  slots?: {
    UserMessage?: React.ComponentType<{
      message: UIMessage;
      className?: string;
      sender?: MessageSender;
      enableImagePreview?: boolean;
    }>;
    ToolRenderer?: React.ComponentType<ToolRendererProps>;
  };
  classNames?: {
    userMessage?: string;
  };
  toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>;
};

const SCROLL_THRESHOLD = 80;
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
type ToolPartBase = {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  result?: unknown;
};

type ToolRendererProps = {
  part: ToolPartBase;
  nestedTools?: ToolPartBase[];
  chatStatus?: string;
  toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>;
};

function normalizeMessages(messages: UIMessage[]): UIMessage[] {
  let changed = false;
  const normalized = messages.map((message) => {
    if (Array.isArray(message.parts) && message.parts.length > 0)
      return message;
    const raw = message as { content?: string; text?: string };
    const content = raw.content ?? raw.text;
    if (typeof content !== "string" || !content) return message;
    changed = true;
    return {
      ...message,
      parts: [{ type: "text", text: content }],
    } as UIMessage;
  });
  return changed ? normalized : messages;
}

function getLastAssistantHasContent(messages: UIMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    return (msg.parts ?? []).some((part) => {
      if (isTextPart(part)) return part.text.trim().length > 0;
      if (isReasoningPart(part)) {
        return part.text.trim().length > 0 || part.state === "streaming";
      }
      return isV5ToolPart(part);
    });
  }
  return false;
}

function getLastUserMessageId(messages: UIMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role === "user") return msg.id;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  return (
    isRecord(part) && part.type === "text" && typeof part.text === "string"
  );
}

function isReasoningPart(
  part: unknown,
): part is { type: "reasoning"; text: string; state?: "streaming" | "done" } {
  return (
    isRecord(part) && part.type === "reasoning" && typeof part.text === "string"
  );
}

function isErrorPart(
  part: unknown,
): part is { type: "error"; title?: string; message: string } {
  return (
    isRecord(part) && part.type === "error" && typeof part.message === "string"
  );
}

function isV5ToolPart(part: unknown): part is ToolPartBase {
  if (!isRecord(part)) return false;
  const partType = part.type;
  return (
    partType === "dynamic-tool" ||
    (typeof partType === "string" && partType.startsWith("tool-"))
  );
}

function getTextFromParts(parts: unknown[], joiner: string): string {
  return parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join(joiner);
}

function formatTimestamp(date: Date): string {
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isSameDay) {
    return timeFormatter.format(date);
  }
  return dateFormatter.format(date);
}

function CopyButton({
  text,
  onCopied,
}: {
  text: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copiedTimerRef.current = null;
    }, 2000);
    onCopied?.();
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-compact"
      tabIndex={-1}
      onClick={handleCopy}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      className="opacity-50 transition-opacity duration-150 ease-out hover:opacity-100 [&_svg]:size-3.5"
    >
      <div className="relative w-3.5 h-3.5">
        <Copy
          aria-hidden
          className={cn(
            "absolute inset-0 text-an-foreground-muted transition-[opacity,transform] duration-150 ease-out",
            copied ? "opacity-0 scale-50" : "opacity-100 scale-100",
          )}
          size={14}
        />
        <Check
          aria-hidden
          className={cn(
            "absolute inset-0 text-an-foreground-muted transition-[opacity,transform] duration-150 ease-out",
            copied ? "opacity-100 scale-100" : "opacity-0 scale-50",
          )}
          size={14}
        />
      </div>
    </Button>
  );
}

function MessageToolbar({
  text,
  timestamp,
  heightClass,
  hoverClass,
  isVisible,
  alignClass,
  onCopied,
}: {
  text?: string;
  timestamp?: string;
  heightClass: string;
  hoverClass: string;
  isVisible: boolean;
  alignClass: string;
  onCopied?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 pt-1 text-caption text-an-foreground-muted/70 opacity-0 transition-opacity duration-100 pointer-events-none",
        heightClass,
        alignClass,
        hoverClass,
        isVisible && "opacity-100 pointer-events-auto",
      )}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {timestamp && <span>{timestamp}</span>}
      {text && <CopyButton text={text} onCopied={onCopied} />}
    </div>
  );
}

function assistantMessageHasContent(msg: UIMessage): boolean {
  return (msg.parts ?? []).some((part) => {
    if (isTextPart(part)) return part.text.trim().length > 0;
    if (isReasoningPart(part)) {
      return part.text.trim().length > 0 || part.state === "streaming";
    }
    if (isErrorPart(part)) return true;
    return isV5ToolPart(part);
  });
}

/** Group flat messages into turns (user message + following assistant messages) */
function groupMessagesIntoTurns(messages: UIMessage[]) {
  const turns: { userMsgs: UIMessage[]; assistantMsgs: UIMessage[] }[] = [];
  let current: { userMsgs: UIMessage[]; assistantMsgs: UIMessage[] } | null =
    null;

  for (const msg of messages) {
    if (msg.role === "user") {
      if (current && current.assistantMsgs.some(assistantMessageHasContent)) {
        turns.push(current);
        current = { userMsgs: [msg], assistantMsgs: [] };
      } else if (current) {
        current.userMsgs.push(msg);
        current.assistantMsgs = [];
      } else {
        current = { userMsgs: [msg], assistantMsgs: [] };
      }
    } else if (msg.role === "assistant") {
      if (!current) current = { userMsgs: [], assistantMsgs: [] };
      current.assistantMsgs.push(msg);
    }
  }
  if (current) turns.push(current);
  return turns;
}

export const MessageList = memo(function MessageList({
  messages,
  status,
  className,
  showCopyToolbar = true,
  suppressQuestionTool = false,
  initialScrollBehavior = "bottom",
  enableImagePreview = true,
  sender,
  slots,
  classNames,
  toolRenderers,
}: MessageListProps) {
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const chatContainerObserverRef = useRef<ResizeObserver | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const prevScrollTopRef = useRef(0);
  const scrollAnimRef = useRef<AnimationPlaybackControls | null>(null);
  /** True while a programmatic follow/jump is in flight — keeps the button hidden. */
  const isProgrammaticFollowRef = useRef(false);
  const lastMessageIdRef = useRef<string | null>(
    messages[messages.length - 1]?.id ?? null,
  );
  const assistantSpaceActiveRef = useRef(false);
  const [activeCopyId, setActiveCopyId] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  /** Jump-to-latest control — shown when the user scrolls away from sticky bottom. */
  const [showFollowButton, setShowFollowButton] = useState(false);

  const CustomUserMessage = slots?.UserMessage || UserMessage;
  const CustomToolRenderer = slots?.ToolRenderer || DefaultToolRenderer;

  const markCopied = useCallback((id: string) => {
    setActiveCopyId(id);
  }, []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const handlePointerDown = () => {
      setActiveCopyId(null);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const isStreaming = status === "streaming" || status === "submitted";

  const containerRefCallback = useCallback((el: HTMLDivElement | null) => {
    const viewport = getScrollViewport(el);
    (
      chatContainerRef as React.MutableRefObject<HTMLDivElement | null>
    ).current = viewport as HTMLDivElement | null;

    if (chatContainerObserverRef.current) {
      chatContainerObserverRef.current.disconnect();
      chatContainerObserverRef.current = null;
    }
    if (el) {
      el.style.setProperty("--chat-container-height", `${el.clientHeight}px`);
      const observer = new ResizeObserver((entries) => {
        const height = entries[0]?.contentRect.height ?? 0;
        el.style.setProperty("--chat-container-height", `${height}px`);
      });
      observer.observe(el);
      chatContainerObserverRef.current = observer;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (chatContainerObserverRef.current)
        chatContainerObserverRef.current.disconnect();
    };
  }, []);

  const stopScrollAnimation = useCallback(() => {
    scrollAnimRef.current?.stop();
    scrollAnimRef.current = null;
  }, []);

  const pinToBottom = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    stopScrollAnimation();
    const target = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = target;
    prevScrollTopRef.current = target;
    isProgrammaticFollowRef.current = false;
    setShowFollowButton(false);
  }, [stopScrollAnimation]);

  /** Discrete jump (send / follow button) — slower than stream follow. */
  const scrollToBottomAnimated = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return () => {};

    const target = Math.max(0, container.scrollHeight - container.clientHeight);
    const from = container.scrollTop;
    if (target - from < 1) {
      container.scrollTop = target;
      prevScrollTopRef.current = target;
      isProgrammaticFollowRef.current = false;
      setShowFollowButton(false);
      return () => {};
    }

    isProgrammaticFollowRef.current = true;
    setShowFollowButton(false);
    stopScrollAnimation();
    const controls = animate(from, target, {
      type: spring.slow.type,
      duration: spring.slow.duration,
      bounce: 0,
      onUpdate: (value) => {
        container.scrollTop = value;
        prevScrollTopRef.current = value;
      },
      onComplete: () => {
        if (scrollAnimRef.current === controls) {
          scrollAnimRef.current = null;
        }
        const settled = Math.max(
          0,
          container.scrollHeight - container.clientHeight,
        );
        container.scrollTop = settled;
        prevScrollTopRef.current = settled;
        isProgrammaticFollowRef.current = false;
        setShowFollowButton(false);
      },
    });
    scrollAnimRef.current = controls;
    return () => {
      controls.stop();
      if (scrollAnimRef.current === controls) {
        scrollAnimRef.current = null;
      }
    };
  }, [stopScrollAnimation]);

  const scrollToBottomSettled = useCallback(() => {
    const cancelAnim = scrollToBottomAnimated();
    const raf = requestAnimationFrame(() => {
      scrollToBottomAnimated();
    });
    return () => {
      cancelAnim();
      cancelAnimationFrame(raf);
      if (!scrollAnimRef.current) {
        isProgrammaticFollowRef.current = false;
      }
    };
  }, [scrollToBottomAnimated]);

  const isAtBottom = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return true;
    return (
      container.scrollHeight - container.scrollTop - container.clientHeight <
      SCROLL_THRESHOLD
    );
  }, []);

  const handleScroll = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const currentScrollTop = container.scrollTop;
    const prevScrollTop = prevScrollTopRef.current;
    prevScrollTopRef.current = currentScrollTop;

    if (
      currentScrollTop < prevScrollTop - 1 &&
      !isProgrammaticFollowRef.current
    ) {
      // User scrolled up — cancel programmatic follow.
      stopScrollAnimation();
      shouldAutoScrollRef.current = false;
      setShowFollowButton(true);
      return;
    }

    // Keep the jump button hidden for the whole spring; don't flash mid-flight.
    if (isProgrammaticFollowRef.current || scrollAnimRef.current) {
      shouldAutoScrollRef.current = true;
      return;
    }

    const atBottom = isAtBottom();
    shouldAutoScrollRef.current = atBottom;
    setShowFollowButton(!atBottom);
  }, [isAtBottom, stopScrollAnimation]);

  const followToBottom = useCallback(() => {
    shouldAutoScrollRef.current = true;
    isProgrammaticFollowRef.current = true;
    setShowFollowButton(false);
    return scrollToBottomSettled();
  }, [scrollToBottomSettled]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll, messages.length]);

  useLayoutEffect(() => {
    const container = chatContainerRef.current;
    const contentWrapper = contentWrapperRef.current;
    if (!container || !contentWrapper) return;

    if (initialScrollBehavior === "top") {
      container.scrollTop = 0;
      shouldAutoScrollRef.current = false;
    } else {
      container.scrollTop = container.scrollHeight;
      shouldAutoScrollRef.current = true;
    }

    let lastContentHeight = contentWrapper.getBoundingClientRect().height;

    const resizeObserver = new ResizeObserver(() => {
      const newContentHeight = contentWrapper.getBoundingClientRect().height;
      if (newContentHeight === lastContentHeight) return;
      lastContentHeight = newContentHeight;

      if (shouldAutoScrollRef.current) {
        // Stream growth must pin, not spring — restarting a 160ms tween on
        // every token/flush is what made the list flash upward.
        pinToBottom();
      }
    });

    resizeObserver.observe(contentWrapper);
    return () => {
      resizeObserver.disconnect();
      stopScrollAnimation();
    };
  }, [pinToBottom, stopScrollAnimation]);

  const normalizedMessages = useMemo(
    () => normalizeMessages(messages),
    [messages],
  );
  const lastMessage = normalizedMessages[normalizedMessages.length - 1];
  const lastMessageId = lastMessage?.id ?? null;
  const lastMessageRole = lastMessage?.role ?? null;
  const lastUserMessageId = useMemo(
    () => getLastUserMessageId(normalizedMessages),
    [normalizedMessages],
  );

  const lastUserMessageIdRef = useRef(lastUserMessageId);
  const pendingPlanningScrollUserIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (
      lastUserMessageId &&
      lastUserMessageId !== lastUserMessageIdRef.current
    ) {
      shouldAutoScrollRef.current = true;
      setShowFollowButton(false);
      pendingPlanningScrollUserIdRef.current = lastUserMessageId;
      pinToBottom();
      lastUserMessageIdRef.current = lastUserMessageId;
    }
  }, [lastUserMessageId, pinToBottom]);

  const planningLabel = "Processing...";
  const turns = useMemo(
    () => groupMessagesIntoTurns(normalizedMessages),
    [normalizedMessages],
  );
  const showPlanning = useMemo(() => {
    const lastMessage = normalizedMessages[normalizedMessages.length - 1];
    if (!lastMessage) return false;
    const lastTurn = turns[turns.length - 1];
    const hasAssistant = Boolean(
      lastTurn && lastTurn.assistantMsgs.some(assistantMessageHasContent),
    );
    if (lastMessage.role === "user" && !hasAssistant) return true;
    return isStreaming && !getLastAssistantHasContent(normalizedMessages);
  }, [isStreaming, normalizedMessages, turns]);
  const isNewAssistantMessage =
    lastMessageRole === "assistant" &&
    Boolean(lastMessageId) &&
    lastMessageId !== lastMessageIdRef.current;
  const showAssistantBreathingSpace =
    showPlanning || assistantSpaceActiveRef.current || isNewAssistantMessage;

  useEffect(() => {
    if (lastMessageRole === "assistant") {
      if (lastMessageId && lastMessageId !== lastMessageIdRef.current) {
        assistantSpaceActiveRef.current = true;
      }
    }
    if (lastMessageRole === "user") {
      assistantSpaceActiveRef.current = false;
    }
    lastMessageIdRef.current = lastMessageId;
  }, [lastMessageId, lastMessageRole]);

  useLayoutEffect(() => {
    if (!showPlanning || !lastUserMessageId) return;
    if (pendingPlanningScrollUserIdRef.current !== lastUserMessageId) return;
    pinToBottom();
    pendingPlanningScrollUserIdRef.current = null;
  }, [lastUserMessageId, showPlanning, pinToBottom]);

  return (
    <div className={cn("relative min-h-0 flex-1", className)}>
      <EmptyPresence>
        {normalizedMessages.length === 0 ? <ChatEmpty /> : null}
      </EmptyPresence>
      <ScrollArea
        ref={containerRefCallback}
        className="an-message-list h-full w-full min-h-0"
        viewportClassName="scroll-fade"
      >
        <div
          ref={contentWrapperRef}
          className="mx-auto w-full max-w-4xl px-4 py-6"
        >
          <div className="space-y-2">
            {turns.map((turn, turnIndex) => {
              const isLastTurn = turnIndex === turns.length - 1;
              const turnKey = turn.userMsgs[0]?.id ?? `turn-${turnIndex}`;
              const visibleAssistantMsgs = turn.assistantMsgs.filter(
                assistantMessageHasContent,
              );

              return (
                <div key={turnKey} className="relative space-y-2">
                  {turn.userMsgs.length > 0 ? (
                    <div className="flex flex-col gap-4">
                      {turn.userMsgs.map((userMsg, userIndex) => {
                        const text = getTextFromParts(userMsg.parts ?? [], "");
                        const hasParts = (userMsg.parts ?? []).length > 0;
                        if (!text && !hasParts) return null;
                        const userCreatedAt = (
                          userMsg as { createdAt?: Date | string }
                        )?.createdAt;
                        const userTimestamp =
                          isMounted && userCreatedAt
                            ? formatTimestamp(new Date(userCreatedAt))
                            : undefined;
                        const showUserToolbar =
                          userIndex === turn.userMsgs.length - 1 &&
                          Boolean(userTimestamp);
                        return (
                          <div className="group/user-message" key={userMsg.id}>
                            <CustomUserMessage
                              message={userMsg}
                              className={classNames?.userMessage}
                              sender={sender}
                              enableImagePreview={enableImagePreview}
                            />
                            {showUserToolbar ? (
                              <MessageToolbar
                                timestamp={userTimestamp}
                                heightClass="h-[28px]"
                                hoverClass="group-hover/user-message:opacity-100 group-hover/user-message:pointer-events-auto"
                                isVisible={false}
                                alignClass="justify-end"
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {visibleAssistantMsgs.length > 0 &&
                    !(isLastTurn && showPlanning) &&
                    (() => {
                      const assistantText = getTextFromParts(
                        visibleAssistantMsgs.flatMap((msg) => msg.parts ?? []),
                        "\n\n",
                      );
                      const isTurnStreaming = isStreaming && isLastTurn;
                      // Only reserve toolbar height when there's actually
                      // something to show in it. With showCopyToolbar=false the
                      // toolbar would otherwise render as a 48px-tall empty box,
                      // creating large gaps between assistant turns.
                      const showToolbar =
                        showCopyToolbar &&
                        Boolean(assistantText.trim()) &&
                        !isTurnStreaming;
                      const copyKey = `assistant-${turnKey}-all`;
                      const toolbarText = showCopyToolbar ? assistantText : "";

                      return (
                        <div className="group/assistant-turn pt-6">
                          <div className="flex flex-col gap-3">
                            {visibleAssistantMsgs.map((msg, i) => {
                              const isLastMsg =
                                isLastTurn &&
                                i === visibleAssistantMsgs.length - 1;
                              return (
                                <AssistantParts
                                  key={msg.id}
                                  msg={msg}
                                  isLast={isLastMsg}
                                  isStreaming={isStreaming}
                                  suppressQuestionTool={suppressQuestionTool}
                                  ToolRendererComponent={CustomToolRenderer}
                                  toolRenderers={toolRenderers}
                                />
                              );
                            })}
                          </div>
                          {showToolbar ? (
                            <MessageToolbar
                              text={toolbarText}
                              heightClass="h-[48px] flex items-start w-full"
                              hoverClass="group-hover/assistant-turn:opacity-100 group-hover/assistant-turn:pointer-events-auto"
                              isVisible={activeCopyId === copyKey}
                              alignClass="justify-start"
                              onCopied={() => markCopied(copyKey)}
                            />
                          ) : activeCopyId === copyKey ? (
                            <MessageToolbar
                              text={toolbarText}
                              heightClass="h-[48px] flex items-start w-full"
                              hoverClass="group-hover/assistant-turn:opacity-100 group-hover/assistant-turn:pointer-events-auto"
                              isVisible={true}
                              alignClass="justify-start"
                              onCopied={() => markCopied(copyKey)}
                            />
                          ) : null}
                        </div>
                      );
                    })()}

                  {isLastTurn && showPlanning ? (
                    <div className="pt-8">
                      <ToolRowBase
                        icon={<Spinner className="size-3.5" />}
                        shimmerLabel={planningLabel}
                        completeLabel="Done"
                        isAnimating={true}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {showAssistantBreathingSpace && (
            <div
              aria-hidden="true"
              className="mx-auto min-h-[max(140px,24vh)] w-full max-w-4xl"
            />
          )}
        </div>
      </ScrollArea>

      {showFollowButton ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="compact"
            trailingIcon={ArrowDownIcon}
            onClick={() => {
              followToBottom();
            }}
            className="pointer-events-auto bg-surface-2"
          >
            Scroll to bottom
          </Button>
        </div>
      ) : null}
    </div>
  );
});

function AssistantParts({
  msg,
  isLast,
  isStreaming,
  suppressQuestionTool,
  ToolRendererComponent,
  toolRenderers,
}: {
  msg: UIMessage;
  isLast: boolean;
  isStreaming: boolean;
  suppressQuestionTool: boolean;
  ToolRendererComponent: React.ComponentType<ToolRendererProps>;
  toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>;
}) {
  const parts = useMemo(
    () => normalizeAssistantToolParts(msg.parts ?? []) as unknown[],
    [msg.parts],
  );

  const { elements } = useMemo(() => {
    const elems: React.ReactNode[] = [];
    const taskPartIds = new Set(
      parts
        .filter(
          (p): p is ToolPartBase =>
            isV5ToolPart(p) &&
            (p.type === "tool-Task" || p.type === "tool-Agent") &&
            typeof p.toolCallId === "string",
        )
        .map((p) => p.toolCallId!),
    );
    const nestedToolsMap = new Map<string, ToolPartBase[]>();
    const nestedToolIds = new Set<string>();

    for (const part of parts) {
      if (!isV5ToolPart(part)) continue;
      if (part.type === "tool-TaskOutput") continue;
      if (!part.toolCallId || !part.toolCallId.includes(":")) continue;
      const parentId = part.toolCallId.split(":")[0];
      if (!taskPartIds.has(parentId)) continue;
      if (!nestedToolsMap.has(parentId)) {
        nestedToolsMap.set(parentId, []);
      }
      nestedToolsMap.get(parentId)!.push(part);
      nestedToolIds.add(part.toolCallId);
    }

    let i = 0;
    while (i < parts.length) {
      const part = parts[i]!;

      if (isV5ToolPart(part) && part.type === "tool-TaskOutput") {
        i++;
        continue;
      }

      if (isTextPart(part)) {
        const text = part.text;
        if (text) {
          const textIsStreaming =
            isLast &&
            isStreaming &&
            // Last text part in this message — earlier paragraphs are done.
            !parts.slice(i + 1).some((later) => isTextPart(later));
          elems.push(
            <div
              key={`${msg.id}-text-${i}`}
              className="group/assistant-text text-body"
            >
              <Markdown
                content={text}
                isAnimating={textIsStreaming}
                className="leading-relaxed [&_p]:leading-relaxed"
              />
            </div>,
          );
        }
        i++;
        continue;
      }

      if (isReasoningPart(part)) {
        const reasoningStreaming =
          part.state === "streaming" ||
          (isLast &&
            isStreaming &&
            part.state !== "done" &&
            !parts
              .slice(i + 1)
              .some(
                (later) =>
                  isReasoningPart(later) ||
                  isTextPart(later) ||
                  isV5ToolPart(later),
              ));
        elems.push(
          <ThinkingTool
            key={`${msg.id}-reasoning-${i}`}
            part={{
              ...part,
              state: reasoningStreaming ? "streaming" : "done",
            }}
            // Keep the latest streaming thought open; settled ones stay collapsed.
            defaultOpen={reasoningStreaming}
          />,
        );
        i++;
        continue;
      }

      if (isErrorPart(part)) {
        elems.push(
          <ErrorMessage
            key={`${msg.id}-error-${i}`}
            title={part.title}
            message={part.message}
          />,
        );
        i++;
        continue;
      }

      if (isV5ToolPart(part)) {
        if (suppressQuestionTool && part.type === "tool-Question") {
          i++;
          continue;
        }
        if (part.toolCallId && nestedToolIds.has(part.toolCallId)) {
          i++;
          continue;
        }

        const chatStreamingStatus =
          isLast && isStreaming ? "streaming" : undefined;
        const toolCallId = part.toolCallId;
        const nestedTools =
          (part.type === "tool-Task" || part.type === "tool-Agent") &&
          toolCallId
            ? nestedToolsMap.get(toolCallId) || []
            : undefined;
        elems.push(
          <ToolRendererComponent
            key={part.toolCallId ?? `${msg.id}-tool-${i}`}
            part={part}
            nestedTools={nestedTools}
            chatStatus={chatStreamingStatus}
            toolRenderers={toolRenderers}
          />,
        );
        i++;
        continue;
      }

      i++;
    }

    return { elements: elems };
  }, [
    parts,
    msg.id,
    isLast,
    isStreaming,
    suppressQuestionTool,
    ToolRendererComponent,
    toolRenderers,
  ]);

  if (elements.length > 1) {
    return (
      <div className="group/assistant-turn flex flex-col gap-3">{elements}</div>
    );
  }

  return <div className="group/assistant-turn">{elements}</div>;
}
