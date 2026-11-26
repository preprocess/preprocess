import {
  CASE_GROUPS,
  CASE_STATUSES,
  parseOrganizationId,
  unassignedGroups,
  type Case,
} from "./case";
import {
  liveAgentsPage,
  liveAssigneeCandidates,
  liveCase,
  liveCaseAccess,
  liveCaseList,
  liveCaseRoomPage,
  liveCasesPage,
  liveSetAssignees,
  liveStartCase,
  liveUploadFile,
  type AssigneeCandidate,
  type CaseAccess,
  type LiveCaseListPage,
  type LiveCaseRoomPage,
} from "./case-api";
import { getCaseFiles, getCaseRoom } from "./case-room-data";
import {
  AWAITING_NONE,
  UNASSIGNED_ANY,
  type CasesGrouping,
  type CasesInboxSearch,
} from "./case-inbox-search";
import {
  parseAgentId,
  parseCaseId,
  type AgentId,
  type CaseId,
} from "./agent-case-ref";
import { SEED_AGENTS, SEED_PEOPLE, createCaseSeed } from "./case-seed";
import {
  getOrgAgent,
  listOrgAgents,
  type OrgAgentDetail,
} from "../agents/list-org-agents";
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
  readonly counts: CaseFacetCounts;
  /** The Awaiting filter's options: group names, and "none" where offered. */
  readonly awaitingOptions: readonly string[];
  /** The Needs assignment filter's options; empty hides the filter. */
  readonly assignmentOptions: readonly string[];
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

/** The live list reads the API; every other state is seeded. */
const live = () => currentScenario().cases === "live";

function seedCases(scenario: CasesScenario): readonly Case[] {
  switch (scenario) {
    case "seeded":
      return createCaseSeed(SEED_ORG);
    case "few":
      return createCaseSeed(SEED_ORG).slice(0, FEW_CASES);
    case "live":
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

/** Seeded case table for the active scenario. */
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
  /** Cases per status under the search and filters, whatever the tab. */
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
  const anyStatus = { ...search, view: "all" as const, status: [] };
  for (const item of seededCases()) {
    if (matches(item, anyStatus, query)) bump(status, item.status);
    if (!matchesView(item, search, query)) continue;
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
export async function listOrgCases(
  search: CasesInboxSearch,
  cursor?: string | null,
  collapsed: ReadonlySet<string> = new Set(),
): Promise<CaseListPage> {
  if (!live()) return seededCaseList(search, cursor, collapsed);
  return liveListPage(
    await liveCaseList({
      data: {
        search,
        cursor: cursor ?? null,
        collapsed: [...collapsed],
        limit: CASE_BATCH_SIZE,
      },
    }).catch(() => null),
  );
}

/** A live batch as the list shows it; null is a batch that didn't load. */
function liveListPage(page: LiveCaseListPage | null): CaseListPage {
  if (page) return { ...page, assignmentOptions: [], loadError: false };
  return {
    rows: [],
    groups: [],
    total: 0,
    nextCursor: null,
    agents: [],
    counts: { status: {}, agent: {}, awaiting: {}, unassigned: {} },
    awaitingOptions: [],
    assignmentOptions: [],
    hasCases: false,
    loadError: true,
  };
}

function seededCaseList(
  search: CasesInboxSearch,
  cursor: string | null | undefined,
  collapsed: ReadonlySet<string>,
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
    counts: facetCounts(search),
    awaitingOptions: [AWAITING_NONE, ...CASE_GROUPS],
    assignmentOptions: [UNASSIGNED_ANY, ...CASE_GROUPS],
    hasCases: all.length > 0,
    loadError: currentScenario().cases === "load-error",
  });
}

/**
 * The agent whose cases a page shows. Seeded cases name agents the API
 * doesn't have, so a seeded scenario stands one in by its slug.
 */
export async function getCaseAgent(
  slug: string,
): Promise<OrgAgentDetail | null> {
  return caseAgent(slug, await getOrgAgent({ data: slug }));
}

function caseAgent(
  slug: string,
  agent: OrgAgentDetail | null,
): OrgAgentDetail | null {
  if (agent || (live() && currentScenario()["case-work"] === "live"))
    return agent;
  return {
    id: slug,
    name: slug,
    productionBranch: "main",
    productionDeploymentId: null,
    production: null,
  };
}

export function getOrgCase(
  agentId: string,
  caseId: string,
): Promise<Case | null> {
  if (live()) return liveCase({ data: caseId });
  return Promise.resolve(
    seededCases().find(
      (item) => item.agentId === agentId && item.id === caseId,
    ) ?? null,
  );
}

/**
 * Marking a case complete or reopening it, where the scenario allows it:
 * only seeded cases, since the API has no such change.
 */
export function orgCaseStatusSetter() {
  return live() ? null : setOrgCaseStatus;
}

/** Sets a seeded case's status. Sticks in memory until the dev server restarts. */
function setOrgCaseStatus(
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

/**
 * The cases before and after this one in the list the search selects. Live,
 * that is the list's first batch; a case past it has no neighbors.
 */
export async function getOrgCaseNeighbors(
  search: CasesInboxSearch,
  agentId: string,
  caseId: string,
): Promise<CaseNeighbors> {
  return neighborsIn(
    live() ? await listOrgCases(search) : null,
    search,
    agentId,
    caseId,
  );
}

function neighborsIn(
  page: CaseListPage | null,
  search: CasesInboxSearch,
  agentId: string,
  caseId: string,
): CaseNeighbors {
  // Live case links may name the agent by id or slug; the case id is unique.
  const ordered = page ? page.rows : orderedCases(search);
  const index = ordered.findIndex(
    (item) => item.id === caseId && (page !== null || item.agentId === agentId),
  );
  return {
    prev: index > 0 ? (ordered[index - 1] ?? null) : null,
    next: index >= 0 ? (ordered[index + 1] ?? null) : null,
    index: index + 1,
    total: page ? page.total : ordered.length,
  };
}

/**
 * What the signed-in person may do to cases. Seeded scenarios act as an
 * Admin who operates every seeded agent.
 */
export function getCaseAccess(): Promise<CaseAccess> {
  if (live()) return liveCaseAccess();
  return Promise.resolve({ canAssign: true, startAgents: [...SEED_AGENTS] });
}

/*
 * Page loaders. Live, each page loads through one server function, so a
 * navigation reads the session and the organization's agents, groups and
 * members once; seeded scenarios compose the functions above.
 */

/**
 * The case list's first batch and the person's case access; with
 * `agentSlug`, that agent's list and the agent itself.
 */
export async function loadCasesPage(
  search: CasesInboxSearch,
  agentSlug: string | null = null,
) {
  const scoped = agentSlug ? { ...search, agent: [agentSlug] } : search;
  if (live()) {
    const { agent, page, access } = await liveCasesPage({
      data: { search: scoped, agent: agentSlug, limit: CASE_BATCH_SIZE },
    });
    return {
      agent: agentSlug ? caseAgent(agentSlug, agent) : null,
      page: liveListPage(page),
      access,
    };
  }
  const [agent, page, access] = await Promise.all([
    agentSlug ? getCaseAgent(agentSlug) : null,
    listOrgCases(scoped),
    getCaseAccess(),
  ]);
  return { agent, page, access };
}

/** The organization's agents and the person's case access. */
export async function loadAgentsPage() {
  if (live()) return liveAgentsPage();
  const [agents, access] = await Promise.all([
    listOrgAgents(),
    getCaseAccess(),
  ]);
  return { agents, access };
}

/**
 * The case room: its agent, the case, its neighbors in `search`'s list, the
 * room's work, the person's case access and the case's files.
 */
export async function loadCaseRoomPage(
  search: CasesInboxSearch,
  agentId: string,
  caseId: string,
) {
  if (live() && currentScenario()["case-work"] === "live") {
    const page = JSON.parse(
      await liveCaseRoomPage({
        data: { agent: agentId, caseId, search, limit: CASE_BATCH_SIZE },
      }),
    ) as LiveCaseRoomPage;
    return {
      agent: page.agent,
      item: page.item,
      neighbors: neighborsIn(liveListPage(page.page), search, agentId, caseId),
      room: page.room,
      access: page.access,
      files: page.files,
    };
  }
  const [agent, item, neighbors, room, access, files] = await Promise.all([
    getCaseAgent(agentId),
    getOrgCase(agentId, caseId),
    getOrgCaseNeighbors(search, agentId, caseId),
    getCaseRoom(agentId, caseId),
    getCaseAccess(),
    getCaseFiles(agentId, caseId),
  ]);
  return { agent, item, neighbors, room, access, files };
}

/**
 * Starts a case by hand: uploads the files, then starts the case with them
 * and the text. Seeded, the case joins the seeded list until the dev server
 * restarts.
 */
export async function startCase(input: {
  agentId: string;
  text: string;
  files: readonly File[];
}): Promise<{ agentId: AgentId; caseId: CaseId }> {
  const text = input.text.trim();
  if (!live()) {
    const now = new Date().toISOString();
    const item: Case = {
      id: parseCaseId(
        `cas_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
      ),
      agentId: parseAgentId(input.agentId),
      orgId: SEED_ORG,
      title: null,
      status: "Active",
      awaiting: [],
      assignees: [],
      externalId: null,
      costCents: 0,
      previewBranch: null,
      createdAt: now,
      updatedAt: now,
    };
    seeded.set(currentScenario().cases, [item, ...seededCases()]);
    return { agentId: item.agentId, caseId: item.id };
  }
  const files: string[] = [];
  for (const file of input.files) {
    const form = new FormData();
    form.set("file", file);
    files.push(await liveUploadFile({ data: form }));
  }
  const caseId = await liveStartCase({
    data: {
      agent: input.agentId,
      text,
      files,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  return { agentId: parseAgentId(input.agentId), caseId: parseCaseId(caseId) };
}

/** The people a case can be assigned to: everyone who can see it. */
export function assigneeCandidates(
  item: Case,
): Promise<readonly AssigneeCandidate[]> {
  if (live()) return liveAssigneeCandidates({ data: item.agentId });
  return Promise.resolve(
    SEED_PEOPLE.map((person) => ({
      id: person.id,
      name: person.name,
      email: person.email,
    })),
  );
}

/** Replaces a case's assignees; seeded, until the dev server restarts. */
export async function setCaseAssignees(
  item: Case,
  ids: readonly string[],
): Promise<void> {
  if (live()) {
    const result = await liveSetAssignees({
      data: { caseId: item.id, userIds: [...ids] },
    });
    if (!result.ok) throw new Error(result.message);
    return;
  }
  seeded.set(
    currentScenario().cases,
    seededCases().map((row) =>
      row.agentId === item.agentId && row.id === item.id
        ? {
            ...row,
            assignees: SEED_PEOPLE.filter((person) => ids.includes(person.id)),
            updatedAt: new Date().toISOString(),
          }
        : row,
    ),
  );
}
