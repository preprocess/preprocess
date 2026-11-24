import { createFileRoute } from "@tanstack/react-router";

import { OrganizationSettingsAction } from "../../../features/settings/settings-widgets";

export const Route = createFileRoute("/settings/organization/members")({
  component: OrganizationMembersPage,
});

function OrganizationMembersPage() {
  return <OrganizationSettingsAction action="members" />;
}
