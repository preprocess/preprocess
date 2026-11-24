"use client";

import { useAuth } from "../../features/auth/auth-context";
import { useMemo, useRef, useState } from "react";

import { InputBar } from "./input-bar";
import { MessageList } from "./message-list";
import { cn } from "./utils/cn";
import type { AgentChatProps } from "./types";
import { FALLBACK_SENDER, senderFromUser } from "./user-message";

export function AgentChat({
  messages,
  onSend,
  status,
  onStop,
  error,
  classNames,
  showCopyToolbar,
  className,
  style,
  sender: senderProp,
}: AgentChatProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const { user } = useAuth();
  const sender = useMemo(
    () => senderProp ?? (user ? senderFromUser(user) : FALLBACK_SENDER),
    [senderProp, user],
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex h-full min-h-0 flex-col",
        classNames?.root,
        className,
      )}
      style={style}
    >
      <MessageList
        messages={
          error
            ? [
                ...messages,
                {
                  id: "agent-chat-error",
                  role: "assistant",
                  parts: [
                    {
                      type: "error",
                      title: "Request failed",
                      message: error.message,
                    },
                  ],
                } as unknown as (typeof messages)[number],
              ]
            : messages
        }
        status={status}
        classNames={classNames}
        showCopyToolbar={showCopyToolbar}
        sender={sender}
      />
      <InputBar
        onSend={onSend}
        status={status}
        onStop={onStop}
        value={draft}
        onChange={setDraft}
        placeholder="Send a message..."
        className={classNames?.inputBar}
      />
    </div>
  );
}
