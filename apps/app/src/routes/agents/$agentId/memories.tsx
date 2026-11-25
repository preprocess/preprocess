import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentPage } from "../../../features/agents/agent-page";
import { AgentMemories } from "../../../features/memories/agent-memories";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/memories")({
  component: AgentMemoriesPage,
});

function AgentMemoriesPage() {
  const agent = agentRoute.useLoaderData();
  return (
    <AgentPage agent={agent} tab="memories">
      <AgentMemories agentSlug={agent.id} />
    </AgentPage>
  );
}
