import { createFileRoute } from "@tanstack/react-router";

import { AgentList } from "../../features/agents/agent-list";
import {
  agentSearchForUrl,
  parseAgentSearch,
  type AgentListSearchParams,
} from "../../features/agents/agent-list-search";
import { listOrgAgents } from "../../features/agents/list-org-agents";

export const Route = createFileRoute("/agents/")({
  staticData: { ownsHeader: true },
  validateSearch: (search: Record<string, unknown>): AgentListSearchParams =>
    agentSearchForUrl(parseAgentSearch(search)),
  loader: () => listOrgAgents(),
  component: AgentsPage,
});

function AgentsPage() {
  const search = parseAgentSearch(Route.useSearch());
  const navigate = Route.useNavigate();

  return (
    <AgentList
      agents={Route.useLoaderData()}
      onSearchChange={(patch) => {
        void navigate({
          search: agentSearchForUrl({ ...search, ...patch }),
          replace: true,
        });
      }}
      search={search}
    />
  );
}
