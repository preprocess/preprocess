import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentPage } from "../../../features/agents/agent-page";
import {
  AGENT_SETTINGS_ANCHORS,
  AgentSettings,
} from "../../../features/agents/agent-settings";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/settings")({
  validateSearch: (search: Record<string, unknown>): { request?: string } =>
    typeof search.request === "string" ? { request: search.request } : {},
  component: AgentSettingsPage,
});

function AgentSettingsPage() {
  const agent = agentRoute.useLoaderData();
  return (
    <AgentPage agent={agent} anchors={AGENT_SETTINGS_ANCHORS} tab="settings">
      <AgentSettings agentSlug={agent.id} request={Route.useSearch().request} />
    </AgentPage>
  );
}
