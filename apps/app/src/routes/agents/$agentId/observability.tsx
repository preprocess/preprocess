import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentObservability } from "../../../features/agents/agent-knowledge";
import { AgentPage } from "../../../features/agents/agent-page";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/observability")({
  component: AgentObservabilityPage,
});

function AgentObservabilityPage() {
  return (
    <AgentPage agent={agentRoute.useLoaderData()} tab="observability">
      <AgentObservability />
    </AgentPage>
  );
}
