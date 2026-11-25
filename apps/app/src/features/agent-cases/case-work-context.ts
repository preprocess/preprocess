import { createContext, useContext } from "react";

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
  /** Approve (the text is an optional note) or reject (the reason). */
  readonly decide: (input: {
    approvalId: string;
    decision: "approve" | "reject";
    text: string;
  }) => Promise<ApprovalDecision>;
};

/** The open case's work and what a person can do to it, for the room's views. */
export const CaseWorkContext = createContext<{
  readonly room: CaseRoomState;
  readonly actions: CaseWorkActions;
} | null>(null);

export function useCaseWork() {
  return useContext(CaseWorkContext);
}
