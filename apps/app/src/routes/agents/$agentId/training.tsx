import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentTraining } from "../../../features/agents/agent-knowledge";
import { AgentPage } from "../../../features/agents/agent-page";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/training")({
  component: AgentTrainingPage,
});

function AgentTrainingPage() {
  return (
    <AgentPage agent={agentRoute.useLoaderData()} tab="training">
      <AgentTraining />
    </AgentPage>
  );
}
