import { createFileRoute } from "@tanstack/react-router";

import { AccountSettingsAction } from "../../../features/settings/settings-widgets";

export const Route = createFileRoute("/settings/account/sessions")({
  component: AccountSessionsPage,
});

function AccountSessionsPage() {
  return <AccountSettingsAction action="sessions" />;
}
