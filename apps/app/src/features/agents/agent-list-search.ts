import type { OrgAgent } from "./list-org-agents";

export type AgentListSearch = { readonly q: string };

export type AgentListSearchParams = { q?: string };

export function parseAgentSearch(raw: unknown): AgentListSearch {
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  return { q: typeof record.q === "string" ? record.q : "" };
}

export function agentSearchForUrl(
  search: AgentListSearch,
): AgentListSearchParams {
  return search.q.trim() ? { q: search.q } : {};
}

/** Agents whose name contains the query, by name. */
export function selectAgents(
  agents: readonly OrgAgent[],
  search: AgentListSearch,
): OrgAgent[] {
  const q = search.q.trim().toLowerCase();
  return agents
    .filter((agent) => agent.name.toLowerCase().includes(q))
    .sort((left, right) => left.name.localeCompare(right.name));
}
