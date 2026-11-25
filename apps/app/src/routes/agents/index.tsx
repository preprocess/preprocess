import { createFileRoute } from "@tanstack/react-router";

import { AgentList } from "../../features/agents/agent-list";
import {
  agentSearchForUrl,
  parseAgentSearch,
  type AgentListSearchParams,
} from "../../features/agents/agent-list-search";
import { listOrgAgents } from "../../features/agents/list-org-agents";
import { AddCaseButton } from "../../features/agent-cases/case-start-dialog";
import { getCaseAccess } from "../../features/agent-cases/list-org-cases";

export const Route = createFileRoute("/agents/")({
  staticData: { ownsHeader: true },
  validateSearch: (search: Record<string, unknown>): AgentListSearchParams =>
    agentSearchForUrl(parseAgentSearch(search)),
  loader: async () => {
    const [agents, access] = await Promise.all([
      listOrgAgents(),
      getCaseAccess(),
    ]);
    return { agents, access };
  },
  component: AgentsPage,
});

function AgentsPage() {
  const search = parseAgentSearch(Route.useSearch());
  const navigate = Route.useNavigate();
  const { agents, access } = Route.useLoaderData();

  return (
    <AgentList
      actions={<AddCaseButton agents={access.startAgents} />}
      agents={agents}
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
