import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentDeployments } from "../../../features/agents/agent-knowledge";
import { AgentPage } from "../../../features/agents/agent-page";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/deployments")({
  component: AgentDeploymentsPage,
});

function AgentDeploymentsPage() {
  return (
    <AgentPage agent={agentRoute.useLoaderData()} tab="deployments">
      <AgentDeployments />
    </AgentPage>
  );
}
