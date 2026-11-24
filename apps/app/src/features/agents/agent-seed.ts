/** Seeded agents, one per agent id the case seed uses. There is no agents backend yet. */

/** What a group can do with an agent; groups without a grant have no access. */
export type AgentAccessLevel = "operator" | "viewer";

export type AgentGrant = {
  /** The organization role (mirrored as a WorkOS group) the grant is for. */
  readonly group: string;
  readonly level: AgentAccessLevel;
};

export type AgentSeed = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** How many times it has deployed; seeds its deployment history. */
  readonly deploys: number;
  readonly deployedAt: string;
  /** Operators first, then viewers. */
  readonly access: readonly AgentGrant[];
};

export const AGENT_SEED: readonly AgentSeed[] = [
  {
    id: "intake",
    name: "Intake",
    description: "Reads incoming packs and pulls out the parties and terms",
    deploys: 14,
    deployedAt: "2026-08-18T16:20:00.000Z",
    access: [
      { group: "Operations", level: "operator" },
      { group: "Finance", level: "viewer" },
    ],
  },
  {
    id: "review",
    name: "Review",
    description: "Checks extracted findings against the source documents",
    deploys: 9,
    deployedAt: "2026-08-17T11:05:00.000Z",
    access: [
      { group: "Legal", level: "operator" },
      { group: "Operations", level: "operator" },
      { group: "Engineering", level: "viewer" },
    ],
  },
  {
    id: "legal",
    name: "Legal",
    description: "Redlines MSAs, NDAs, and privacy addenda",
    deploys: 22,
    deployedAt: "2026-08-15T09:40:00.000Z",
    access: [{ group: "Legal", level: "operator" }],
  },
  {
    id: "sales",
    name: "Sales",
    description: "Prepares order forms and renewal packs",
    deploys: 6,
    deployedAt: "2026-08-12T14:10:00.000Z",
    access: [
      { group: "Sales", level: "operator" },
      { group: "Finance", level: "viewer" },
    ],
  },
  {
    id: "support",
    name: "Support",
    description: "Follows up on customer incidents",
    deploys: 11,
    deployedAt: "2026-08-16T18:30:00.000Z",
    access: [
      { group: "Support", level: "operator" },
      { group: "Operations", level: "viewer" },
      { group: "Sales", level: "viewer" },
    ],
  },
  {
    id: "lab",
    name: "Lab",
    description: "Tries new case types before they ship",
    deploys: 31,
    deployedAt: "2026-08-19T08:55:00.000Z",
    access: [{ group: "Engineering", level: "operator" }],
  },
];
