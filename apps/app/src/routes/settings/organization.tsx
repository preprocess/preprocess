import { createFileRoute } from "@tanstack/react-router";

import { OrganizationSettingsSection } from "../../features/settings/settings-section";

export const Route = createFileRoute("/settings/organization")({
  component: OrganizationSettingsSection,
});
