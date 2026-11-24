import { createFileRoute } from "@tanstack/react-router";

import { AgentSettingsTab } from "../../../features/agents/agent-settings-tab";
import { getPlatformSettings } from "../../../features/developers/platform-store";

export const Route = createFileRoute("/agents/$agentId/settings")({
  loader: () => getPlatformSettings(),
  component: AgentSettingsPage,
});

function AgentSettingsPage() {
  return (
    <AgentSettingsTab platform={Route.useLoaderData()} section="settings" />
  );
}
