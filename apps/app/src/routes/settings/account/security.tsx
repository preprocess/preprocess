import { createFileRoute } from "@tanstack/react-router";

import { AccountSettingsAction } from "../../../features/settings/settings-widgets";

export const Route = createFileRoute("/settings/account/security")({
  component: AccountSecurityPage,
});

function AccountSecurityPage() {
  return <AccountSettingsAction action="security" />;
}
