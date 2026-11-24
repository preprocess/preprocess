import { createFileRoute } from "@tanstack/react-router";

import { OrganizationSettingsAction } from "../../../features/settings/settings-widgets";

export const Route = createFileRoute("/settings/organization/billing")({
  component: OrganizationBillingPage,
});

function OrganizationBillingPage() {
  return <OrganizationSettingsAction action="billing" />;
}
