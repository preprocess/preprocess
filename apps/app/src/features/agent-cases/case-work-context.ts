import { createContext, useContext } from "react";

import type { OptionPage } from "./case-api";
import type {
  ApprovalDecision,
  CaseRoomState,
  WriteResult,
} from "./case-room-state";

export type CaseWorkActions = {
  readonly edit: (input: {
    path: string;
    value: unknown;
    version: number;
  }) => Promise<WriteResult>;
  readonly confirm: (input: {
    path: string;
    version: number;
  }) => Promise<WriteResult>;
  readonly accept: (input: {
    path: string;
    version: number;
  }) => Promise<WriteResult>;
  readonly rerun: () => Promise<unknown>;
  readonly cancel: () => Promise<unknown>;
  /** Completes a waiting case; absent when the person cannot work it. */
  readonly complete?: () => Promise<ApprovalDecision>;
  /** Approve (the text is an optional note) or reject (the reason). */
  readonly decide: (input: {
    approvalId: string;
    decision: "approve" | "reject";
    text: string;
  }) => Promise<ApprovalDecision>;
  /** Accepts or dismisses a memory rule the agent proposed. */
  readonly decideMemory: (input: {
    memoryId: string;
    decision: "accept" | "dismiss";
  }) => Promise<ApprovalDecision>;
  /** Posts to the case thread; @group mentions notify that group. */
  readonly post: (text: string) => Promise<ApprovalDecision>;
  /** Searches a select field's full option list, past what the room lists. */
  readonly searchOptions: (input: {
    path: string;
    query: string;
  }) => Promise<OptionPage>;
};

/** The open case's work and what a person can do to it, for the room's views. */
export const CaseWorkContext = createContext<{
  readonly room: CaseRoomState;
  readonly actions: CaseWorkActions;
} | null>(null);

export function useCaseWork() {
  return useContext(CaseWorkContext);
}
