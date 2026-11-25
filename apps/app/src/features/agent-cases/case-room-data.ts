import { currentScenario } from "../../scenarios/current-scenario";
import {
  liveAnswerWrite,
  liveApprovalDecision,
  liveCaseCommand,
  liveCaseRoom,
} from "./case-api";
import * as seed from "./case-room-seed";
import type { CaseWorkActions } from "./case-work-context";

/**
 * The case room's work and what a person does to it: from the API when the
 * case-work scenario is live, else from the seeded state it names.
 */
const live = () => currentScenario()["case-work"] === "live";

export function getCaseRoom(agentId: string, caseId: string) {
  return live() ? liveCaseRoom(caseId) : seed.getCaseRoom(agentId, caseId);
}

/** The room's actions; `refresh` reloads the room after each one. */
export function caseWorkActions(
  agentId: string,
  caseId: string,
  refresh: <T>(result: Promise<T>) => Promise<T>,
): CaseWorkActions {
  if (!live())
    return {
      edit: (input) => refresh(seed.editAnswer(agentId, caseId, input)),
      confirm: (input) => refresh(seed.confirmAnswer(agentId, caseId, input)),
      accept: (input) => refresh(seed.acceptSuggestion(agentId, caseId, input)),
      rerun: () => refresh(seed.rerunCase(agentId, caseId)),
      cancel: () => refresh(seed.cancelCase(agentId, caseId)),
      decide: (input) => refresh(seed.decideApproval(agentId, caseId, input)),
    };
  const write = (
    kind: "edit" | "confirm" | "accept",
    input: { path: string; version: number; value?: unknown },
  ) => refresh(liveAnswerWrite({ data: { caseId, kind, ...input } }));
  return {
    edit: (input) => write("edit", input),
    confirm: (input) => write("confirm", input),
    accept: (input) => write("accept", input),
    rerun: () =>
      refresh(liveCaseCommand({ data: { caseId, command: "rerun" } })),
    cancel: () =>
      refresh(liveCaseCommand({ data: { caseId, command: "cancel" } })),
    decide: (input) =>
      refresh(liveApprovalDecision({ data: { caseId, ...input } })),
  };
}
