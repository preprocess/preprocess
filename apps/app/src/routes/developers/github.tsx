import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/developers/github")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/organization/github" });
  },
});
