import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentAccess } from "../../../features/agents/agent-knowledge";
import { AgentPage } from "../../../features/agents/agent-page";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/access")({
  component: AgentAccessPage,
});

function AgentAccessPage() {
  return (
    <AgentPage agent={agentRoute.useLoaderData()} tab="access">
      <AgentAccess />
    </AgentPage>
  );
}
