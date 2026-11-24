import { createFileRoute, redirect } from "@tanstack/react-router";

// Feedback lives on each agent now (its Feedback tab).
export const Route = createFileRoute("/developers/feedback")({
  beforeLoad: () => {
    throw redirect({ to: "/agents" });
  },
});
