import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/developers/network")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/organization/network" });
  },
});
