import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  McpServers,
  type ConnectResult,
} from "../../../features/developers/mcp-servers";

type IntegrationsSearch = { connected?: string; connect_error?: string };

const CONNECT_ERRORS = ["cancelled", "expired", "refused"] as const;

export const Route = createFileRoute("/settings/organization/integrations")({
  validateSearch: (search: Record<string, unknown>): IntegrationsSearch => ({
    ...(typeof search.connected === "string" && {
      connected: search.connected,
    }),
    ...(typeof search.connect_error === "string" && {
      connect_error: search.connect_error,
    }),
  }),
  component: OrganizationIntegrations,
});

/** What agents connect to outside Preprocess: MCP servers. */
function OrganizationIntegrations() {
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
        to: "/settings/organization/integrations",
        search: {},
        replace: true,
      });
  }, [navigate, search.connected, search.connect_error]);

  return <McpServers connectResult={connectResult} />;
}
