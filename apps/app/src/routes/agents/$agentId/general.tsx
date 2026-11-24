import { createFileRoute, redirect } from "@tanstack/react-router";

// The agent's name, icon, and description moved onto its overview.
export const Route = createFileRoute("/agents/$agentId/general")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/agents/$agentId", params });
  },
});
