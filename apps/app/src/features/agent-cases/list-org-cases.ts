import {
  CASE_STATUSES,
  parseOrganizationId,
  unassignedGroups,
  type Case,
} from "./case";
import {
  AWAITING_NONE,
  UNASSIGNED_ANY,
  type CasesGrouping,
  type CasesInboxSearch,
} from "./case-inbox-search";
import { agentSummaries, type AgentSummary } from "../agents/agent-store";
import { createCaseSeed } from "./case-seed";
import { currentScenario } from "../../scenarios/current-scenario";
import type { ScenarioState } from "../../scenarios/scenarios";

/** One group in the filtered list, with its size across every batch. */
export type CaseListGroup = {
  readonly key: string;
  readonly total: number;
};

/** Rows the list fetches at a time as it scrolls. */
export const CASE_BATCH_SIZE = 100;

/**
 * One batch of the case list, already filtered, grouped, and sorted. The
 * list asks for the next batch with `nextCursor` as it nears the end, so
 * there are no pages; group totals cover every batch.
 */
export type CaseListPage = {
  readonly rows: readonly Case[];
  readonly groups: readonly CaseListGroup[];
  readonly total: number;
  readonly nextCursor: string | null;
  /** Agents with at least one case, for the agent filter. */
  readonly agents: readonly string[];
  /** Name and mark for each agent the rows and filter show. */
  readonly agentInfo: Readonly<Record<string, AgentSummary>>;
  readonly counts: CaseFacetCounts;
  /** Whether the organization has any cases at all, before filters. */
  readonly hasCases: boolean;
  readonly loadError: boolean;
};

export type CaseNeighbors = {
  readonly prev: Case | null;
  readonly next: Case | null;
  /** 1-based position in the list, or 0 when the case is not in it. */
  readonly index: number;
  readonly total: number;
};

const SEED_ORG = parseOrganizationId("org_seed");

type CasesScenario = ScenarioState<"cases">;

/** Cases the "few" scenario keeps from the seed. */
const FEW_CASES = 3;

function seedCases(scenario: CasesScenario): readonly Case[] {
  switch (scenario) {
    case "seeded":
      return createCaseSeed(SEED_ORG);
    case "few":
      return createCaseSeed(SEED_ORG).slice(0, FEW_CASES);
    case "empty":
    case "load-error":
      return [];
    default: {
      const exhaustive: never = scenario;
      return exhaustive;
    }
  }
}

const seeded = new Map<CasesScenario, readonly Case[]>();

/**
 * Seeded case table for the active scenario. There is no cases backend yet;
 * builds outside dev get the empty scenario.
 */
function seededCases(): readonly Case[] {
  const scenario = currentScenario().cases;
  let cases = seeded.get(scenario);
  if (!cases) {
    cases = seedCases(scenario);
    seeded.set(scenario, cases);
  }
  return cases;
}

export function caseGroupKey(item: Case, grouping: CasesGrouping): string {
  switch (grouping) {
    case "status":
      return item.status;
    case "agent":
      return item.agentId;
    case "none":
      return "all";
    default: {
      const _exhaustive: never = grouping;
      return _exhaustive;
    }
  }
}

function groupRank(key: string, grouping: CasesGrouping): number {
  if (grouping !== "status") return 0;
  return CASE_STATUSES.indexOf(key as (typeof CASE_STATUSES)[number]);
}

/** The tab and the search text, without the Filter menu's facets. */
function matchesView(item: Case, search: CasesInboxSearch, query: string) {
  if ((item.previewBranch !== null) !== (search.env === "previews")) {
    return false;
  }
  if (search.view === "active" && item.status !== "Active") return false;
  if (search.view === "waiting" && item.status !== "Waiting") return false;
  if (search.view === "done" && item.status !== "Done") return false;
  if (!query) return true;
  const haystack =
    `${item.title ?? ""} ${item.agentId} ${item.id} ${item.externalId ?? ""} ${item.awaiting.join(" ")} ${item.assignees.map((assignee) => assignee.name).join(" ")}`.toLowerCase();
  return haystack.includes(query);
}

function matches(item: Case, search: CasesInboxSearch, query: string) {
  if (!matchesView(item, search, query)) return false;
  if (search.agent.length > 0 && !search.agent.includes(item.agentId)) {
    return false;
  }
  if (search.status.length > 0 && !search.status.includes(item.status)) {
    return false;
  }
  if (search.awaiting.length > 0) {
    const wantsNone = search.awaiting.includes(AWAITING_NONE);
    const hit =
      item.awaiting.length === 0
        ? wantsNone
        : item.awaiting.some((group) => search.awaiting.includes(group));
    if (!hit) return false;
  }
  if (search.unassigned.length > 0) {
    const uncovered = unassignedGroups(item);
    const hit =
      (search.unassigned.includes(UNASSIGNED_ANY) && uncovered.length > 0) ||
      uncovered.some((group) => search.unassigned.includes(group));
    if (!hit) return false;
  }
  return true;
}

/** How many cases have each filter value. */
export type CaseFacetCounts = {
  readonly status: Readonly<Record<string, number>>;
  readonly agent: Readonly<Record<string, number>>;
  readonly awaiting: Readonly<Record<string, number>>;
  /** Cases needing assignment, by uncovered group, and "any" for all of them. */
  readonly unassigned: Readonly<Record<string, number>>;
};

/**
 * Counts for the Filter menu, over the cases the tab and search show. The
 * facets themselves don't narrow them, so a value's count stays put while
 * other values are picked.
 */
function facetCounts(search: CasesInboxSearch): CaseFacetCounts {
  const query = search.q.trim().toLowerCase();
  const status: Record<string, number> = {};
  const agent: Record<string, number> = {};
  const awaiting: Record<string, number> = {};
  const unassigned: Record<string, number> = {};
  const bump = (counts: Record<string, number>, key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  for (const item of seededCases()) {
    if (!matchesView(item, search, query)) continue;
    bump(status, item.status);
    bump(agent, item.agentId);
    if (item.awaiting.length === 0) bump(awaiting, AWAITING_NONE);
    for (const group of item.awaiting) bump(awaiting, group);
    const uncovered = unassignedGroups(item);
    if (uncovered.length > 0) bump(unassigned, UNASSIGNED_ANY);
    for (const group of uncovered) bump(unassigned, group);
  }
  return { status, agent, awaiting, unassigned };
}

function timeOf(item: Case, search: CasesInboxSearch) {
  const time = Date.parse(item[search.sort]);
  return Number.isNaN(time) ? 0 : time;
}

/** Every case the search selects, in display order: by group, then by time. */
function orderedCases(search: CasesInboxSearch): Case[] {
  const query = search.q.trim().toLowerCase();
  return seededCases()
    .filter((item) => matches(item, search, query))
    .sort((left, right) => {
      const leftKey = caseGroupKey(left, search.group);
      const rightKey = caseGroupKey(right, search.group);
      if (leftKey !== rightKey) {
        const rank =
          groupRank(leftKey, search.group) - groupRank(rightKey, search.group);
        return rank !== 0 ? rank : leftKey.localeCompare(rightKey);
      }
      const delta = timeOf(left, search) - timeOf(right, search);
      return search.dir === "asc" ? delta : -delta;
    });
}

function offsetOf(cursor: string | null | undefined) {
  const offset = cursor ? Number.parseInt(cursor, 10) : 0;
  return Number.isFinite(offset) && offset > 0 ? offset : 0;
}

/**
 * One batch of the list. Rows of `collapsed` groups are left out of the
 * batches (the cursor walks only the rows that show), but `groups` still
 * lists every group with its full total, so their headers draw at once.
 */
export function listOrgCases(
  search: CasesInboxSearch,
  cursor?: string | null,
  collapsed: ReadonlySet<string> = new Set(),
): Promise<CaseListPage> {
  const all = seededCases();
  const ordered = orderedCases(search);
  const shown = ordered.filter(
    (item) => !collapsed.has(caseGroupKey(item, search.group)),
  );
  const groups: CaseListGroup[] = [];
  for (const item of ordered) {
    const key = caseGroupKey(item, search.group);
    const last = groups.at(-1);
    if (last?.key === key) {
      groups[groups.length - 1] = { key, total: last.total + 1 };
    } else {
      groups.push({ key, total: 1 });
    }
  }
  const offset = offsetOf(cursor);
  const end = offset + CASE_BATCH_SIZE;
  return Promise.resolve({
    rows: shown.slice(offset, end),
    groups,
    total: ordered.length,
    nextCursor: end < shown.length ? String(end) : null,
    agents: [...new Set(all.map((item) => item.agentId))].sort(),
    agentInfo: agentSummaries(),
    counts: facetCounts(search),
    hasCases: all.length > 0,
    loadError: currentScenario().cases === "load-error",
  });
}

export function getOrgCase(
  agentId: string,
  caseId: string,
): Promise<Case | null> {
  return Promise.resolve(
    seededCases().find(
      (item) => item.agentId === agentId && item.id === caseId,
    ) ?? null,
  );
}

/** Sets a seeded case's status. Sticks in memory until the dev server restarts. */
export function setOrgCaseStatus(
  agentId: string,
  caseId: string,
  status: Case["status"],
): Promise<Case | null> {
  let updated: Case | null = null;
  const next = seededCases().map((item) => {
    if (item.agentId !== agentId || item.id !== caseId) return item;
    updated = {
      ...item,
      status,
      // Only a waiting case waits on anyone.
      awaiting: status === "Waiting" ? item.awaiting : [],
      updatedAt: new Date().toISOString(),
    };
    return updated;
  });
  seeded.set(currentScenario().cases, next);
  return Promise.resolve(updated);
}

/** The cases before and after this one in the list the search selects. */
export function getOrgCaseNeighbors(
  search: CasesInboxSearch,
  agentId: string,
  caseId: string,
): Promise<CaseNeighbors> {
  const ordered = orderedCases(search);
  const index = ordered.findIndex(
    (item) => item.agentId === agentId && item.id === caseId,
  );
  return Promise.resolve({
    prev: index > 0 ? (ordered[index - 1] ?? null) : null,
    next: index >= 0 ? (ordered[index + 1] ?? null) : null,
    index: index + 1,
    total: ordered.length,
  });
}

/** One agent's cases by status, and when any of them last changed. */
export type AgentCaseStats = {
  readonly byStatus: Readonly<Record<Case["status"], number>>;
  readonly total: number;
  /** What all of the agent's cases have cost, in US cents. */
  readonly costCents: number;
  readonly lastUpdatedAt: string | null;
};

export function getOrgCaseStatsByAgent(): Promise<
  ReadonlyMap<string, AgentCaseStats>
> {
  const stats = new Map<string, AgentCaseStats>();
  for (const item of seededCases()) {
    // Agents' stats count production work only.
    if (item.previewBranch !== null) continue;
    const current = stats.get(item.agentId) ?? {
      byStatus: { Waiting: 0, Active: 0, Done: 0 },
      total: 0,
      costCents: 0,
      lastUpdatedAt: null,
    };
    stats.set(item.agentId, {
      byStatus: {
        ...current.byStatus,
        [item.status]: current.byStatus[item.status] + 1,
      },
      total: current.total + 1,
      costCents: current.costCents + item.costCents,
      lastUpdatedAt:
        current.lastUpdatedAt === null ||
        Date.parse(item.updatedAt) > Date.parse(current.lastUpdatedAt)
          ? item.updatedAt
          : current.lastUpdatedAt,
    });
  }
  return Promise.resolve(stats);
}
