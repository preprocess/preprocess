import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/developers/webhooks")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/organization/api-keys" });
  },
});
