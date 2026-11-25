import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentSettings } from "../../../features/agents/agent-knowledge";
import { AgentPage } from "../../../features/agents/agent-page";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/settings")({
  component: AgentSettingsPage,
});

function AgentSettingsPage() {
  return (
    <AgentPage agent={agentRoute.useLoaderData()} tab="settings">
      <AgentSettings />
    </AgentPage>
  );
}
