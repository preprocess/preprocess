import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentMemories } from "../../../features/agents/agent-knowledge";
import { AgentPage } from "../../../features/agents/agent-page";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/memories")({
  component: AgentMemoriesPage,
});

function AgentMemoriesPage() {
  return (
    <AgentPage agent={agentRoute.useLoaderData()} tab="memories">
      <AgentMemories />
    </AgentPage>
  );
}
