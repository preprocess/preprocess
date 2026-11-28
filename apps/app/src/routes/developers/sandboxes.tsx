import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/developers/sandboxes")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/organization/sandboxes" });
  },
});
