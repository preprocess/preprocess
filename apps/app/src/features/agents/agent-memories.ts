/** Memories approved in case chats. There is no memories backend yet. */

export type AgentMemory = {
  readonly id: string;
  readonly text: string;
  /** Learned on a case, or added by a person. */
  readonly source: "learned" | "added";
  /** The case it was learned on, or who added it. */
  readonly from: string;
  readonly createdAt: string;
};

/** Memories approved in a case chat since the dev server started. */
const approved: { agentId: string; memory: AgentMemory }[] = [];

/**
 * Saves a memory someone approved in a case's chat, where the agent proposed
 * it. Memories are only approved there, never on the agent page.
 */
export function approveAgentMemory(
  agentId: string,
  text: string,
  caseLabel: string,
): Promise<AgentMemory> {
  const memory: AgentMemory = {
    id: `${agentId}-approved-${approved.length}`,
    text,
    source: "learned",
    from: caseLabel,
    createdAt: new Date().toISOString(),
  };
  approved.push({ agentId, memory });
  return Promise.resolve(memory);
}
