import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/organization/login")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/organization/authentication" });
  },
});
