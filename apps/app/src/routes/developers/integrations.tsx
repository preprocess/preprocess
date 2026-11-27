import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  McpServers,
  type ConnectResult,
} from "../../features/developers/mcp-servers";
import { DeveloperSettingsPage } from "../../features/settings/settings-widgets";

type IntegrationsSearch = { connected?: string; connect_error?: string };

const CONNECT_ERRORS = ["cancelled", "expired", "refused"] as const;

export const Route = createFileRoute("/developers/integrations")({
  validateSearch: (search: Record<string, unknown>): IntegrationsSearch => ({
    ...(typeof search.connected === "string" && {
      connected: search.connected,
    }),
    ...(typeof search.connect_error === "string" && {
      connect_error: search.connect_error,
    }),
  }),
  component: DevelopersIntegrationsPage,
});

/** What agents connect to outside Preprocess: MCP servers. */
function DevelopersIntegrationsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  // The OAuth callback sends the browser back here with the outcome; it is
  // shown once, and the query is dropped so a reload doesn't repeat it.
  const [connectResult] = useState<ConnectResult | null>(() => {
    if (search.connected) return { connected: search.connected };
    const error = CONNECT_ERRORS.find((kind) => kind === search.connect_error);
    return error ? { connectError: error } : null;
  });
  useEffect(() => {
    if (search.connected || search.connect_error)
      void navigate({
        to: "/developers/integrations",
        search: {},
        replace: true,
      });
  }, [navigate, search.connected, search.connect_error]);

  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <DeveloperSettingsPage title="Integrations">
        <McpServers connectResult={connectResult} />
      </DeveloperSettingsPage>
    </ScrollArea>
  );
}
