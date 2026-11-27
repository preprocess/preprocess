import { createFileRoute, redirect } from "@tanstack/react-router";

// Keeps the OAuth outcome (connected, connect_error) on the way to the new page.
export const Route = createFileRoute("/developers/integrations")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/settings/organization/integrations", search });
  },
});
