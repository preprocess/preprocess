import { createFileRoute, redirect } from "@tanstack/react-router";

// Sandbox image, secrets, and network share the Settings tab now.
export const Route = createFileRoute("/agents/$agentId/sandbox")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/agents/$agentId/settings", params });
  },
});
