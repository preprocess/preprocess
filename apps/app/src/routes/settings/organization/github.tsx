import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/organization/github")({
  beforeLoad: () => {
    throw redirect({ to: "/developers/integrations" });
  },
});
