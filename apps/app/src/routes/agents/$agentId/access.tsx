import { createFileRoute } from "@tanstack/react-router";

import { AgentSettingsTab } from "../../../features/agents/agent-settings-tab";
import { getPlatformSettings } from "../../../features/developers/platform-store";

export const Route = createFileRoute("/agents/$agentId/access")({
  loader: () => getPlatformSettings(),
  component: AgentAccessPage,
});

function AgentAccessPage() {
  return <AgentSettingsTab platform={Route.useLoaderData()} section="access" />;
}
