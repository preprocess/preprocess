import { createFileRoute } from "@tanstack/react-router";

import { AccountSettingsAction } from "../../../features/settings/settings-widgets";

export const Route = createFileRoute("/settings/account/api-keys")({
  component: AccountApiKeysPage,
});

function AccountApiKeysPage() {
  return <AccountSettingsAction action="api-keys" />;
}
