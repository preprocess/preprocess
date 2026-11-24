/** Seeded memories per agent. There is no memories backend yet. */

export type AgentMemory = {
  readonly id: string;
  readonly text: string;
  /** Learned on a case, or added by a person. */
  readonly source: "learned" | "added";
  /** The case it was learned on, or who added it. */
  readonly from: string;
  readonly createdAt: string;
};

type MemorySeed = Omit<AgentMemory, "id">;

const MEMORY_SEED: Readonly<Record<string, readonly MemorySeed[]>> = {
  intake: [
    {
      text: "Globex renewal packs put the term dates in the order form, not the MSA.",
      source: "learned",
      from: "Globex renewal pack 121",
      createdAt: "2026-08-17T15:40:00.000Z",
    },
    {
      text: "Treat a signed SOW amendment as superseding the original SOW's fees.",
      source: "added",
      from: "Mina Okafor",
      createdAt: "2026-08-16T10:12:00.000Z",
    },
    {
      text: "Vendor diligence packs list the parent company as the contracting party.",
      source: "learned",
      from: "Globex vendor diligence 601",
      createdAt: "2026-08-15T13:25:00.000Z",
    },
    {
      text: "Skip cover emails when counting pages for a pack.",
      source: "added",
      from: "Ada Park",
      createdAt: "2026-08-13T09:02:00.000Z",
    },
    {
      text: "Initech order forms write currency as a code after the amount.",
      source: "learned",
      from: "Initech order form 212",
      createdAt: "2026-08-11T17:48:00.000Z",
    },
    {
      text: "Flag auto-renewal clauses with notice periods under 30 days.",
      source: "added",
      from: "Theo Grant",
      createdAt: "2026-08-08T14:30:00.000Z",
    },
  ],
  review: [
    {
      text: "Quote the exact clause number when a finding disagrees with the source.",
      source: "added",
      from: "Jules Moreau",
      createdAt: "2026-08-16T11:20:00.000Z",
    },
    {
      text: "Scanned exhibits often drop the last digit of totals; check the summary page.",
      source: "learned",
      from: "Globex MSA redlines 361",
      createdAt: "2026-08-14T16:05:00.000Z",
    },
  ],
  legal: [
    {
      text: "Our standard liability cap is 12 months of fees; mark anything higher.",
      source: "added",
      from: "Ada Park",
      createdAt: "2026-08-15T08:50:00.000Z",
    },
    {
      text: "Privacy addenda from EU customers reference the 2021 SCCs by module number.",
      source: "learned",
      from: "Initech privacy addendum 44",
      createdAt: "2026-08-12T12:35:00.000Z",
    },
  ],
  sales: [
    {
      text: "Renewal packs carry over the prior year's discount unless the order form says otherwise.",
      source: "learned",
      from: "Globex renewal pack 121",
      createdAt: "2026-08-12T15:10:00.000Z",
    },
  ],
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

/** An agent's memories, newest first. Seeded in development; builds outside dev serve none. */
export function listAgentMemories(agentId: string): readonly AgentMemory[] {
  if (!import.meta.env.DEV) return [];
  return [
    ...(MEMORY_SEED[agentId] ?? []).map((memory, index) => ({
      ...memory,
      id: `${agentId}-memory-${index}`,
    })),
    ...approved
      .filter((entry) => entry.agentId === agentId)
      .map((entry) => entry.memory),
  ].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}
