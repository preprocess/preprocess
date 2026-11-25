import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentPage } from "../../../../../features/agents/agent-page";
import {
  useOrgJson,
  type EvalSuiteDetail,
} from "../../../../../features/evals/eval-api";
import {
  EvalSuiteView,
  suitePolls,
} from "../../../../../features/evals/eval-suite";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsError,
  SettingsSkeletonRows,
} from "../../../../../features/settings/kit";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/evaluations/$suiteId/")({
  component: EvalSuitePage,
});

function EvalSuitePage() {
  const agent = agentRoute.useLoaderData();
  const { suiteId } = Route.useParams();
  const { state, reload, organizationId } = useOrgJson<EvalSuiteDetail>(
    `/eval-suites/${encodeURIComponent(suiteId)}`,
    suitePolls,
  );
  return (
    <AgentPage
      agent={agent}
      detail={state.kind === "ready" ? state.data.name : "Suite"}
      tab="evaluations"
    >
      {state.kind === "loading" ? (
        <SettingsCard>
          <SettingsSkeletonRows count={4} />
        </SettingsCard>
      ) : state.kind === "missing" ? (
        <SettingsEmpty
          description="It may have been deleted."
          title="This suite doesn't exist"
        />
      ) : state.kind === "failed" ? (
        <SettingsError error={state.error} />
      ) : (
        <EvalSuiteView
          agentSlug={agent.id}
          organizationId={organizationId}
          reload={reload}
          suite={state.data}
        />
      )}
    </AgentPage>
  );
}
