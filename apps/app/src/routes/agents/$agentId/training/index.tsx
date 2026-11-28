import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentPage } from "../../../../features/agents/agent-page";
import { AgentTrainingTab } from "../../../../features/training/training-tab";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/training/")({
  component: AgentTrainingPage,
});

function AgentTrainingPage() {
  const agent = agentRoute.useLoaderData();
  return (
    <AgentPage agent={agent} tab="training">
      <AgentTrainingTab agentSlug={agent.id} />
    </AgentPage>
  );
}
