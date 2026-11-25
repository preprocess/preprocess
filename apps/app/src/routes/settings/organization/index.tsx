import { createFileRoute } from "@tanstack/react-router";

import { SettingsSection } from "../../../features/settings/kit";
import {
  DeleteOrganizationPanel,
  OrganizationDetailsPanel,
  OrganizationPanel,
} from "../../../features/settings/organization-panel";
import { SettingsStacked } from "../../../features/settings/settings-widgets";

export const Route = createFileRoute("/settings/organization/")({
  component: OrganizationGeneralPage,
});

function OrganizationGeneralPage() {
  return (
    <SettingsStacked>
      <SettingsSection title="Branding">
        <OrganizationPanel />
      </SettingsSection>
      <SettingsSection title="Details">
        <OrganizationDetailsPanel />
      </SettingsSection>
      <SettingsSection title="Dangerous actions">
        <DeleteOrganizationPanel />
      </SettingsSection>
    </SettingsStacked>
  );
}
