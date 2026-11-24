import { createFileRoute } from "@tanstack/react-router";

import { OrganizationSettingsAction } from "../../../features/settings/settings-widgets";

export const Route = createFileRoute("/settings/organization/authentication")({
  component: OrganizationAuthenticationPage,
});

function OrganizationAuthenticationPage() {
  return <OrganizationSettingsAction action="authentication" />;
}
