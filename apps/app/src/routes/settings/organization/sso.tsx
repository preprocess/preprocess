import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/organization/sso")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/organization/authentication" });
  },
});
