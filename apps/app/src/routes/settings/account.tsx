import { createFileRoute } from "@tanstack/react-router";

import { AccountSettingsSection } from "../../features/settings/settings-section";

export const Route = createFileRoute("/settings/account")({
  component: AccountSettingsSection,
});
