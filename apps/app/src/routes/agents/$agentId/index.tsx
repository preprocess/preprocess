import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentOverview, AgentPage } from "../../../features/agents/agent-page";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/")({
  component: AgentOverviewPage,
});

function AgentOverviewPage() {
  const agent = agentRoute.useLoaderData();
  return (
    <AgentPage agent={agent} tab="">
      <AgentOverview agent={agent} />
    </AgentPage>
  );
}
