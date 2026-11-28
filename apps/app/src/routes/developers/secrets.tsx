import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/developers/secrets")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/organization/secrets" });
  },
});
