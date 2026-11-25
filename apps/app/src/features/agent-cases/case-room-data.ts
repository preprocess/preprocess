import { currentScenario } from "../../scenarios/current-scenario";
import {
  liveAnswerWrite,
  liveApprovalDecision,
  liveCaseCommand,
  liveCaseRoom,
  liveCompleteCase,
  liveMemoryDecision,
  livePostMessage,
  liveSearchOptions,
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

/**
 * The room's actions; `refresh` reloads the room after each one. `canWork`
 * is whether the person works the agent's cases, which Complete needs.
 */
export function caseWorkActions(
  agentId: string,
  caseId: string,
  refresh: <T>(result: Promise<T>) => Promise<T>,
  canWork: boolean,
): CaseWorkActions {
  if (!live())
    return {
      edit: (input) => refresh(seed.editAnswer(agentId, caseId, input)),
      confirm: (input) => refresh(seed.confirmAnswer(agentId, caseId, input)),
      accept: (input) => refresh(seed.acceptSuggestion(agentId, caseId, input)),
      rerun: () => refresh(seed.rerunCase(agentId, caseId)),
      cancel: () => refresh(seed.cancelCase(agentId, caseId)),
      complete: canWork
        ? () => refresh(seed.completeCase(agentId, caseId))
        : undefined,
      decide: (input) => refresh(seed.decideApproval(agentId, caseId, input)),
      decideMemory: (input) =>
        refresh(seed.decideMemory(agentId, caseId, input)),
      post: (text) => refresh(seed.postMessage(agentId, caseId, text)),
      searchOptions: (input) => seed.searchOptions(agentId, caseId, input),
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
    complete: canWork
      ? () => refresh(liveCompleteCase({ data: caseId }))
      : undefined,
    decide: (input) =>
      refresh(liveApprovalDecision({ data: { caseId, ...input } })),
    decideMemory: (input) =>
      refresh(liveMemoryDecision({ data: { caseId, ...input } })),
    post: (text) => refresh(livePostMessage({ data: { caseId, text } })),
    searchOptions: (input) => liveSearchOptions({ data: { caseId, ...input } }),
  };
}
