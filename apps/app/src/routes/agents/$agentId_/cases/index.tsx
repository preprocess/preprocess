import { createFileRoute, notFound } from "@tanstack/react-router";

import { CaseInbox } from "../../../../features/agent-cases/case-inbox";
import {
  casesSearchForUrl,
  parseCasesSearch,
  patchCasesSearch,
  type CasesSearchParams,
} from "../../../../features/agent-cases/case-inbox-search";
import {
  getCaseAgent,
  listOrgCases,
} from "../../../../features/agent-cases/list-org-cases";

// Not nested under /agents/$agentId: seeded cases name agents the API
// doesn't have, so this page loads its agent through getCaseAgent.
export const Route = createFileRoute("/agents/$agentId_/cases/")({
  staticData: { ownsHeader: true },
  validateSearch: (search: Record<string, unknown>): CasesSearchParams =>
    casesSearchForUrl(parseCasesSearch(search)),
  loaderDeps: ({ search }) => ({ search: parseCasesSearch(search) }),
  loader: async ({ params, deps }) => {
    const [agent, page] = await Promise.all([
      getCaseAgent(params.agentId),
      listOrgCases({ ...deps.search, agent: [params.agentId] }),
    ]);
    if (!agent) throw notFound();
    return { agent, page };
  },
  component: AgentCasesPage,
  notFoundComponent: () => (
    <p className="p-6 text-body">This agent doesn't exist.</p>
  ),
});

function AgentCasesPage() {
  const { agent, page } = Route.useLoaderData();
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
    />
  );
}
