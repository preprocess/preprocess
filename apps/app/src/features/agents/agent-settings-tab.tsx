import { getRouteApi, useRouter } from "@tanstack/react-router";

import type { PlatformSettings } from "../developers/platform-store";
import { AgentPage } from "./agent-page";
import { AgentSettings, type AgentSettingsSection } from "./agent-settings";
import {
  deleteAgentEnvVar,
  deleteAgentMcpServer,
  deleteAgentNetworkRule,
  setAgentAccess,
  setAgentEnvVar,
  setAgentEveryoneAccess,
  setAgentNetworkRule,
  saveAgentMcpServer,
  setAgentMcpEnabled,
  setAgentMcpTools,
  setAgentRepo,
  setAgentSandboxImage,
} from "./agent-store";

const agentRoute = getRouteApi("/agents/$agentId");

/**
 * One of the agent page's settings tabs: Access, Secrets, Network, or
 * Sandbox. Every change saves, then reloads the agent and the
 * organization's settings.
 */
export function AgentSettingsTab({
  section,
  platform,
}: Readonly<{
  section: AgentSettingsSection;
  platform: PlatformSettings;
}>) {
  const agent = agentRoute.useLoaderData();
  const router = useRouter();

  const run =
    <T extends unknown[]>(
      change: (id: string, ...args: T) => Promise<unknown>,
    ) =>
    async (...args: T) => {
      await change(agent.id, ...args);
      await router.invalidate();
    };

  return (
    <AgentPage agent={agent} tab={section}>
      <AgentSettings
        actions={{
          setRepo: run(setAgentRepo),
          setAccess: run(setAgentAccess),
          setEveryoneAccess: run(setAgentEveryoneAccess),
          setSandboxImage: run(setAgentSandboxImage),
          saveEnvVar: run(setAgentEnvVar),
          deleteEnvVar: run(deleteAgentEnvVar),
          addNetworkRule: run(setAgentNetworkRule),
          deleteNetworkRule: run(deleteAgentNetworkRule),
          setMcpEnabled: run(setAgentMcpEnabled),
          setMcpTools: run(setAgentMcpTools),
          saveMcpServer: run(saveAgentMcpServer),
          deleteMcpServer: run(deleteAgentMcpServer),
        }}
        agent={agent}
        platform={platform}
        section={section}
      />
    </AgentPage>
  );
}
