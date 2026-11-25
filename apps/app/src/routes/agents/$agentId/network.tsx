import { createFileRoute, redirect } from "@tanstack/react-router";

// An agent's network rules live in its Settings.
export const Route = createFileRoute("/agents/$agentId/network")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/agents/$agentId/settings",
      params,
      hash: "network",
    });
  },
});
