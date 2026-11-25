import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentConfiguration } from "../../../features/agents/agent-knowledge";
import { AgentPage } from "../../../features/agents/agent-page";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/configuration")({
  component: AgentConfigurationPage,
});

function AgentConfigurationPage() {
  return (
    <AgentPage agent={agentRoute.useLoaderData()} tab="configuration">
      <AgentConfiguration />
    </AgentPage>
  );
}
