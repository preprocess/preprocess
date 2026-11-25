import { parseAgentId, parseCaseId } from "./agent-case-ref";
import {
  CASE_GROUPS,
  CASE_STATUSES,
  type Case,
  type CaseAssignee,
  type CaseGroup,
  type CaseStatus,
  type OrganizationId,
} from "./case";

/** Deterministic case table for the seeded `cases` scenario. */
export const CASE_SEED_COUNT = 1000;

type SeedCase = {
  readonly id: string;
  readonly agentId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export const SEED_AGENTS = [
  "lab",
  "intake",
  "review",
  "sales",
  "support",
  "legal",
] as const;

const COMPANIES = [
  "Acme",
  "Globex",
  "Initech",
  "Umbrella",
  "Hooli",
  "Stark",
  "Wayne",
  "Soylent",
  "Massive Dynamic",
  "Weyland",
] as const;

const MATTERS = [
  "vendor diligence",
  "inbound contracts",
  "renewal pack",
  "NDA review",
  "SOW amendment",
  "security questionnaire",
  "MSA redlines",
  "privacy addendum",
  "order form",
  "incident follow-up",
] as const;

const ORIGINALS: readonly SeedCase[] = [
  {
    id: "cas_7f3a2b1c9e04",
    agentId: "lab",
    title: "Acme vendor diligence",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-17T18:00:00.000Z",
  },
  {
    id: "cas_intake_01",
    agentId: "intake",
    title: "Q3 inbound contracts",
    createdAt: "2026-08-10T09:00:00.000Z",
    updatedAt: "2026-08-16T14:30:00.000Z",
  },
  {
    id: "cas_await_all",
    agentId: "legal",
    title: "Multi-party closing pack",
    createdAt: "2026-08-12T09:00:00.000Z",
    updatedAt: "2026-08-18T20:00:00.000Z",
  },
  {
    id: "cas_await_many",
    agentId: "review",
    title: "Cross-team incident review",
    createdAt: "2026-08-14T11:00:00.000Z",
    updatedAt: "2026-08-18T19:00:00.000Z",
  },
];

function isoDaysAgo(days: number, hours: number) {
  const date = new Date(Date.UTC(2026, 7, 18, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hours, (days * 7) % 60, 0, 0);
  return date.toISOString();
}

function createSeedRows(count: number): SeedCase[] {
  const seed = ORIGINALS.slice(0, Math.min(count, ORIGINALS.length));
  for (let index = seed.length; index < count; index += 1) {
    const company = COMPANIES[index % COMPANIES.length];
    const matter =
      MATTERS[Math.floor(index / COMPANIES.length) % MATTERS.length];
    seed.push({
      id: `cas_gen_${String(index).padStart(4, "0")}`,
      agentId: SEED_AGENTS[index % SEED_AGENTS.length],
      title: `${company} ${matter} ${index}`,
      createdAt: isoDaysAgo(30 + (index % 400), 8 + (index % 10)),
      updatedAt: isoDaysAgo(index % 120, 10 + (index % 12)),
    });
  }
  return seed;
}

/** Seeded people and their groups. Groups nobody here belongs to (Review,
 *  Compliance, Design, People) always leave a case needing assignment. */
export const SEED_PEOPLE: readonly CaseAssignee[] = [
  { name: "Ada Park", email: "ada@example.com", groups: ["Legal", "Counsel"] },
  {
    name: "Theo Grant",
    email: "theo@example.com",
    groups: ["Sales", "Finance"],
  },
  {
    name: "Mina Okafor",
    email: "mina@example.com",
    groups: ["Engineering", "Security"],
  },
  {
    name: "Jules Moreau",
    email: "jules@example.com",
    groups: ["Ops", "Support"],
  },
];

const CROWDED_AWAITING: Readonly<Record<string, readonly CaseGroup[]>> = {
  cas_await_all: CASE_GROUPS,
  cas_await_many: CASE_GROUPS.slice(0, 8),
};

function hashString(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % 2147483647;
  }
  return hash;
}

function seedStatus(id: string, hash: number): CaseStatus {
  // The crowded cases exist to show long awaiting lists, so they wait.
  if (CROWDED_AWAITING[id]) return "Waiting";
  return CASE_STATUSES[hash % CASE_STATUSES.length] ?? "Active";
}

/**
 * One or two groups for a waiting case, stable per case id. Only waiting
 * cases wait on anyone; active and done cases wait on no one.
 */
function seedAwaiting(
  id: string,
  hash: number,
  status: CaseStatus,
): readonly CaseGroup[] {
  const crowded = CROWDED_AWAITING[id];
  if (crowded) return crowded;
  if (status !== "Waiting") return [];
  const bucket = (hash >> 3) % 8;
  const first = CASE_GROUPS[hash % CASE_GROUPS.length];
  if (!first) return [];
  if (bucket <= 2) {
    const second = CASE_GROUPS[(hash + 2) % CASE_GROUPS.length];
    if (second && second !== first) return [first, second];
  }
  return [first];
}

/** 20¢–$4.99 of runs so far; finished cases have run the longest. */
function seedCost(hash: number, status: CaseStatus): number {
  const base = 20 + ((hash >> 7) % 380);
  return status === "Done" ? base + 100 : base;
}

/** Nobody, one person, or a few: stable per case id. */
function seedAssignees(hash: number): CaseAssignee[] {
  const count = [0, 1, 1, 1, 2, 2, 3, 4][(hash >> 5) % 8] ?? 1;
  const start = (hash >> 9) % SEED_PEOPLE.length;
  return Array.from(
    { length: count },
    (_, offset) => SEED_PEOPLE[(start + offset) % SEED_PEOPLE.length],
  ).filter((assignee): assignee is CaseAssignee => assignee !== undefined);
}

/** A few cases ran on preview deployments, one per sixteen. */
const PREVIEW_BRANCHES = ["feat/exhibit-check", "fix/retry-timeouts"] as const;

export function createCaseSeed(
  orgId: OrganizationId,
  count = CASE_SEED_COUNT,
): Case[] {
  return createSeedRows(count).map((row) => {
    const hash = hashString(row.id);
    const status = seedStatus(row.id, hash);
    const generated = row.id.startsWith("cas_gen_");
    return {
      ...row,
      id: parseCaseId(row.id),
      agentId: parseAgentId(row.agentId),
      orgId,
      // Titles and external IDs are optional: about a third of generated
      // cases have no title, and a quarter come without an external ID.
      title: generated && hash % 3 === 0 ? null : row.title,
      externalId:
        generated && (hash >> 2) % 4 === 0
          ? null
          : `REQ-${String(10000 + (hash % 90000))}`,
      status,
      awaiting: seedAwaiting(row.id, hash, status),
      assignees: seedAssignees(hash),
      costCents: seedCost(hash, status),
      previewBranch:
        hash % 16 === 0
          ? (PREVIEW_BRANCHES[(hash >> 4) % PREVIEW_BRANCHES.length] ?? null)
          : null,
    };
  });
}
