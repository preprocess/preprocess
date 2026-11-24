import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/organization/integrations")({
  beforeLoad: () => {
    throw redirect({ to: "/developers/integrations" });
  },
});
