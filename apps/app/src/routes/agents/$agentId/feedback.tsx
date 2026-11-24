import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/agents/$agentId/feedback")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/agents/$agentId", params });
  },
});
