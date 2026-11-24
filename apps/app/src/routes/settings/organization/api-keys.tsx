import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/organization/api-keys")({
  beforeLoad: () => {
    throw redirect({ to: "/developers/api" });
  },
});
