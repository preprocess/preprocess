import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import {
  clearMcpServer,
  mcpServerUsage,
} from "../../features/agents/agent-store";
import { OrgMcpSection } from "../../features/developers/mcp-servers";
import {
  deleteOrgMcpServer,
  getPlatformSettings,
  saveOrgMcpServer,
} from "../../features/developers/platform-store";
import {
  DeveloperSettingsAction,
  DeveloperSettingsPage,
} from "../../features/settings/settings-widgets";

export const Route = createFileRoute("/developers/integrations")({
  loader: async () => ({
    servers: (await getPlatformSettings()).mcpServers,
    usage: Object.fromEntries(mcpServerUsage()),
  }),
  component: DevelopersIntegrationsPage,
});

/** Everything agents connect to outside Preprocess: data sources and MCP servers. */
function DevelopersIntegrationsPage() {
  const { servers, usage } = Route.useLoaderData();
  const router = useRouter();

  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <DeveloperSettingsPage title="Integrations">
        <DeveloperSettingsAction action="integrations" />
        <OrgMcpSection
          onDelete={async (id) => {
            await deleteOrgMcpServer(id);
            await clearMcpServer(id);
            await router.invalidate();
          }}
          onSave={async (input, id) => {
            await saveOrgMcpServer(input, id);
            await router.invalidate();
          }}
          servers={servers}
          usage={usage}
        />
      </DeveloperSettingsPage>
    </ScrollArea>
  );
}
