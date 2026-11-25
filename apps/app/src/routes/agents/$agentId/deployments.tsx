import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentDeployments } from "../../../features/agents/agent-deployments";
import { AgentPage } from "../../../features/agents/agent-page";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/deployments")({
  component: AgentDeploymentsPage,
});

function AgentDeploymentsPage() {
  const agent = agentRoute.useLoaderData();
  return (
    <AgentPage agent={agent} tab="deployments">
      <AgentDeployments agent={agent} />
    </AgentPage>
  );
}
