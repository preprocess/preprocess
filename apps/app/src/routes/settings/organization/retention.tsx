import { createFileRoute, notFound } from "@tanstack/react-router";

import { loadRetentionRole } from "../../../features/settings/retention-api";
import { RetentionPanel } from "../../../features/settings/retention-panel";

export const Route = createFileRoute("/settings/organization/retention")({
  loader: async () => {
    const role = await loadRetentionRole();
    if (!role) throw notFound();
    return role;
  },
  component: OrganizationRetention,
});

function OrganizationRetention() {
  return <RetentionPanel role={Route.useLoaderData()} />;
}
