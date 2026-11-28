import { createFileRoute, notFound } from "@tanstack/react-router";

import { AgentNotFound } from "../../../../components/route-states";
import { CaseInbox } from "../../../../features/agent-cases/case-inbox";
import {
  casesSearchForUrl,
  parseCasesSearch,
  patchCasesSearch,
  type CasesSearchParams,
} from "../../../../features/agent-cases/case-inbox-search";
import { loadCasesPage } from "../../../../features/agent-cases/list-org-cases";

// Not nested under /agents/$agentId: seeded cases name agents the API
// doesn't have, so this page loads its agent through loadCasesPage.
export const Route = createFileRoute("/agents/$agentId_/cases/")({
  staticData: { ownsHeader: true },
  validateSearch: (search: Record<string, unknown>): CasesSearchParams =>
    casesSearchForUrl(parseCasesSearch(search)),
  loaderDeps: ({ search }) => ({ search: parseCasesSearch(search) }),
  loader: async ({ params, deps }) => {
    const { agent, page, access } = await loadCasesPage(
      deps.search,
      params.agentId,
    );
    if (!agent) throw notFound();
    return { agent, page, access };
  },
  component: AgentCasesPage,
  notFoundComponent: AgentNotFound,
});

function AgentCasesPage() {
  const { agent, page, access } = Route.useLoaderData();
  const search = parseCasesSearch(Route.useSearch());
  const navigate = Route.useNavigate();

  return (
    <CaseInbox
      agent={agent}
      onSearchChange={(patch, meta) => {
        void navigate({
          search: casesSearchForUrl(patchCasesSearch(search, patch)),
          replace: meta?.replace ?? true,
        });
      }}
      page={page}
      search={{ ...search, agent: [agent.id] }}
      startAgents={access.startAgents}
    />
  );
}
