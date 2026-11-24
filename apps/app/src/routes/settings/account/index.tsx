import { createFileRoute } from "@tanstack/react-router";

import { AccountSettingsAction } from "../../../features/settings/settings-widgets";

export const Route = createFileRoute("/settings/account/")({
  component: AccountProfilePage,
});

function AccountProfilePage() {
  return <AccountSettingsAction action="profile" />;
}
