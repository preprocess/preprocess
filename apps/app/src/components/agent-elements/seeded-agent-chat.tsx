"use client";

import { cn } from "@preprocess/ui/lib/utils";
import type { ChatStatus, UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  SEEDED_TRANSCRIPT,
  seededReply,
} from "../../features/agent-cases/case-room-transcripts";
import { AgentChat } from "./agent-chat";

export type SeededAgentChatProps = {
  className?: string;
};

const REPLY_DELAY_MS = 700;

/**
 * Agent Elements chat over a seeded transcript. Sending appends the message
 * and a canned reply so the composer and pending states stay exercisable.
 */
export function SeededAgentChat({ className }: SeededAgentChatProps) {
  const [messages, setMessages] = useState<UIMessage[]>(() => [
    ...SEEDED_TRANSCRIPT,
  ]);
  const [status, setStatus] = useState<ChatStatus>("ready");
  const replyTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(replyTimer.current), []);

  const handleSend = useCallback(
    ({ content }: { role: "user"; content: string }) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const id = `msg_local_${Date.now()}`;
      setMessages((current) => [
        ...current,
        { id, role: "user", parts: [{ type: "text", text: trimmed }] },
      ]);
      setStatus("submitted");
      window.clearTimeout(replyTimer.current);
      replyTimer.current = window.setTimeout(() => {
        setMessages((current) => [...current, seededReply(`${id}_reply`)]);
        setStatus("ready");
      }, REPLY_DELAY_MS);
    },
    [],
  );

  const handleStop = useCallback(() => {
    window.clearTimeout(replyTimer.current);
    setStatus("ready");
  }, []);

  return (
    <AgentChat
      messages={messages}
      status={status}
      onSend={handleSend}
      onStop={handleStop}
      className={cn("h-full min-h-0", className)}
    />
  );
}
