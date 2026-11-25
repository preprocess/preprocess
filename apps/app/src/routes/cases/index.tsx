import { createFileRoute } from "@tanstack/react-router";

import { CaseInbox } from "../../features/agent-cases/case-inbox";
import {
  casesSearchForUrl,
  parseCasesSearch,
  patchCasesSearch,
  type CasesSearchParams,
} from "../../features/agent-cases/case-inbox-search";
import {
  getCaseAccess,
  listOrgCases,
} from "../../features/agent-cases/list-org-cases";

export const Route = createFileRoute("/cases/")({
  staticData: { ownsHeader: true },
  validateSearch: (search: Record<string, unknown>): CasesSearchParams =>
    casesSearchForUrl(parseCasesSearch(search)),
  loaderDeps: ({ search }) => ({ search: parseCasesSearch(search) }),
  loader: async ({ deps }) => {
    const [page, access] = await Promise.all([
      listOrgCases(deps.search),
      getCaseAccess(),
    ]);
    return { page, access };
  },
  component: CasesIndexPage,
});

function CasesIndexPage() {
  const { page, access } = Route.useLoaderData();
  const search = parseCasesSearch(Route.useSearch());
  const navigate = Route.useNavigate();

  return (
    <CaseInbox
      onSearchChange={(patch, meta) => {
        void navigate({
          search: casesSearchForUrl(patchCasesSearch(search, patch)),
          replace: meta?.replace ?? true,
        });
      }}
      page={page}
      search={search}
      startAgents={access.startAgents}
    />
  );
}
