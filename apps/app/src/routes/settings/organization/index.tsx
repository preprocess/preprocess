import { createFileRoute } from "@tanstack/react-router";

import { OrganizationSettingsAction } from "../../../features/settings/settings-widgets";

export const Route = createFileRoute("/settings/organization/")({
  component: OrganizationGeneralPage,
});

function OrganizationGeneralPage() {
  return <OrganizationSettingsAction action="general" />;
}
