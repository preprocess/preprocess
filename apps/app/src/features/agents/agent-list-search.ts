import type { OrgAgent } from "./list-org-agents";

/** How the agent list can be ordered; each sort has one fixed direction. */
export const AGENT_SORTS = [
  "activity",
  "name",
  "cost",
  "avg-cost",
  "waiting",
  "deployed",
] as const;
export type AgentSort = (typeof AGENT_SORTS)[number];

export const AGENT_SORT_LABEL: Record<AgentSort, string> = {
  activity: "Last activity",
  name: "Name",
  cost: "Total cost",
  "avg-cost": "Average cost",
  waiting: "Most waiting",
  deployed: "Last deployed",
};

export type AgentListSearch = {
  readonly q: string;
  /** Agents any of these groups can access. */
  readonly group: readonly string[];
  /** Only agents with cases waiting on people. */
  readonly waiting: boolean;
  readonly sort: AgentSort;
};

export type AgentListSearchParams = {
  q?: string;
  group?: readonly string[];
  waiting?: boolean;
  sort?: AgentSort;
};

export const DEFAULT_AGENT_SEARCH: AgentListSearch = {
  q: "",
  group: [],
  waiting: false,
  sort: "activity",
};

function asStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (Array.isArray(value)) return value.flatMap((item) => asStringList(item));
  return [];
}

function isAgentSort(value: unknown): value is AgentSort {
  return (
    typeof value === "string" &&
    (AGENT_SORTS as readonly string[]).includes(value)
  );
}

export function parseAgentSearch(raw: unknown): AgentListSearch {
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  return {
    q: typeof record.q === "string" ? record.q : "",
    group: asStringList(record.group),
    waiting: record.waiting === true || record.waiting === "true",
    sort: isAgentSort(record.sort) ? record.sort : DEFAULT_AGENT_SEARCH.sort,
  };
}

export function agentSearchForUrl(
  search: AgentListSearch,
): AgentListSearchParams {
  const next: AgentListSearchParams = {};
  if (search.q.trim()) next.q = search.q;
  if (search.group.length > 0) next.group = [...search.group];
  if (search.waiting) next.waiting = true;
  if (search.sort !== DEFAULT_AGENT_SEARCH.sort) next.sort = search.sort;
  return next;
}

function timeOf(value: string | null) {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function averageCost(agent: OrgAgent) {
  return agent.stats.total > 0 ? agent.stats.costCents / agent.stats.total : 0;
}

const SORTERS: Record<AgentSort, (left: OrgAgent, right: OrgAgent) => number> =
  {
    activity: (left, right) =>
      timeOf(right.stats.lastUpdatedAt) - timeOf(left.stats.lastUpdatedAt),
    name: (left, right) => left.name.localeCompare(right.name),
    cost: (left, right) => right.stats.costCents - left.stats.costCents,
    "avg-cost": (left, right) => averageCost(right) - averageCost(left),
    waiting: (left, right) =>
      right.stats.byStatus.Waiting - left.stats.byStatus.Waiting,
    deployed: (left, right) =>
      timeOf(right.deployedAt) - timeOf(left.deployedAt),
  };

/** The agents the search selects, in its order. */
export function selectAgents(
  agents: readonly OrgAgent[],
  search: AgentListSearch,
): OrgAgent[] {
  const query = search.q.trim().toLowerCase();
  return agents
    .filter((agent) => {
      if (
        query &&
        !`${agent.name} ${agent.id} ${agent.description}`
          .toLowerCase()
          .includes(query)
      ) {
        return false;
      }
      if (
        search.group.length > 0 &&
        !search.group.some((group) => agentReachableBy(agent, group))
      ) {
        return false;
      }
      if (search.waiting && agent.stats.byStatus.Waiting === 0) return false;
      return true;
    })
    .sort(SORTERS[search.sort]);
}

/** Whether a group's members can reach the agent: through a grant of its
 *  own, or because the agent is open to everyone. */
export function agentReachableBy(agent: OrgAgent, group: string): boolean {
  return (
    agent.everyone !== null ||
    agent.access.some((grant) => grant.group === group)
  );
}

/** Every group that holds access to some agent, for the group filter. */
export function agentGroups(agents: readonly OrgAgent[]): string[] {
  return [
    ...new Set(agents.flatMap((agent) => agent.access.map((g) => g.group))),
  ].sort();
}
