import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/developers/mcp")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/organization/integrations" });
  },
});
