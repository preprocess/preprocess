import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentEvaluations } from "../../../features/agents/agent-knowledge";
import { AgentPage } from "../../../features/agents/agent-page";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/evaluations")({
  component: AgentEvaluationsPage,
});

function AgentEvaluationsPage() {
  return (
    <AgentPage agent={agentRoute.useLoaderData()} tab="evaluations">
      <AgentEvaluations />
    </AgentPage>
  );
}
