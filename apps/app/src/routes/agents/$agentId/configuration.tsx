import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentConfiguration } from "../../../features/agents/agent-configuration";
import { agentDefinition } from "../../../features/agents/agent-definition";
import { AgentPage } from "../../../features/agents/agent-page";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/configuration")({
  component: AgentConfigurationPage,
});

function AgentConfigurationPage() {
  const agent = agentRoute.useLoaderData();
  return (
    <AgentPage agent={agent} tab="configuration">
      <AgentConfiguration
        agentId={agent.id}
        definition={agentDefinition(agent.id, agent.name)}
      />
    </AgentPage>
  );
}
