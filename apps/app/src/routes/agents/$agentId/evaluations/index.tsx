import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentPage } from "../../../../features/agents/agent-page";
import { AgentEvalSuites } from "../../../../features/evals/eval-suites";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/evaluations/")({
  component: AgentEvaluationsPage,
});

function AgentEvaluationsPage() {
  const agent = agentRoute.useLoaderData();
  return (
    <AgentPage agent={agent} tab="evaluations">
      <AgentEvalSuites agentSlug={agent.id} />
    </AgentPage>
  );
}
