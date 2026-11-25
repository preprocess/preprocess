import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentPage } from "../../../../../../features/agents/agent-page";
import {
  shortId,
  useOrgJson,
  type EvalRunDetail,
  type EvalSuite,
} from "../../../../../../features/evals/eval-api";
import {
  EvalRunView,
  runPolls,
} from "../../../../../../features/evals/eval-run";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsError,
  SettingsSkeletonRows,
} from "../../../../../../features/settings/kit";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute(
  "/agents/$agentId/evaluations/$suiteId/runs/$runId",
)({
  component: EvalRunPage,
});

function EvalRunPage() {
  const agent = agentRoute.useLoaderData();
  const { suiteId, runId } = Route.useParams();
  const { state } = useOrgJson<EvalRunDetail>(
    `/eval-runs/${encodeURIComponent(runId)}`,
    runPolls,
  );
  const suite = useOrgJson<EvalSuite>(
    `/eval-suites/${encodeURIComponent(suiteId)}`,
  ).state;
  return (
    <AgentPage
      agent={agent}
      detail={`Run ${shortId(runId)}`}
      parent={{
        label: suite.kind === "ready" ? suite.data.name : "Suite",
        link: (
          <Link
            params={{ agentId: agent.id, suiteId }}
            to="/agents/$agentId/evaluations/$suiteId"
          />
        ),
      }}
      tab="evaluations"
    >
      {state.kind === "loading" ? (
        <SettingsCard>
          <SettingsSkeletonRows count={4} />
        </SettingsCard>
      ) : state.kind === "missing" ? (
        <SettingsEmpty
          description="Its suite may have been deleted."
          title="This run doesn't exist"
        />
      ) : state.kind === "failed" ? (
        <SettingsError error={state.error} />
      ) : (
        <EvalRunView run={state.data} />
      )}
    </AgentPage>
  );
}
