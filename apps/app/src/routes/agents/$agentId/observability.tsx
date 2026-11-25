import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentPage } from "../../../features/agents/agent-page";
import { AgentLogs } from "../../../features/logs/agent-logs";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/observability")({
  component: AgentObservabilityPage,
});

function AgentObservabilityPage() {
  const agent = agentRoute.useLoaderData();
  return (
    <AgentPage agent={agent} tab="observability">
      <AgentLogs agentSlug={agent.id} />
    </AgentPage>
  );
}
