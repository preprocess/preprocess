import type React from "react";
import type { ChatStatus, UIMessage } from "ai";

import type { MessageSender } from "./user-message";

/** Per-element CSS class overrides */
export type ChatClassNames = {
  root: string;
  userMessage: string;
  inputBar: string;
};

/** Props passed to custom tool renderer components */
export type CustomToolRendererProps = {
  name: string;
  input: Record<string, unknown>;
  output: unknown | undefined;
  status: "pending" | "streaming" | "success" | "error";
};

/** Props for the <AgentChat> drop-in component (lab / controlled usage). */
export type AgentChatProps = {
  messages: UIMessage[];
  onSend: (message: { role: "user"; content: string }) => void;
  status: ChatStatus;
  onStop: () => void;
  error?: Error;
  classNames?: Partial<ChatClassNames>;
  className?: string;
  style?: React.CSSProperties;
  /** Show copy toolbar on text turns */
  showCopyToolbar?: boolean;
  /** Who sent user turns. AgentChat fills this from the session when omitted. */
  sender?: MessageSender;
};
