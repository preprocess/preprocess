import { createFileRoute } from "@tanstack/react-router";

import { ModelsPanel } from "../../../features/models/models-panel";
import { SettingsSwitcher } from "../../../features/settings/settings-nav";
import {
  SettingsChrome,
  SettingsPageHeader,
} from "../../../features/settings/settings-widgets";

// Settings › Developers › Models (PRE-145). The settings sidebar's Developers
// group (PRE-136) lists it; until then the page renders in the settings
// layout with its own title.
export const Route = createFileRoute("/settings/organization_/models")({
  component: OrganizationModels,
});

function OrganizationModels() {
  return (
    <SettingsChrome>
      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-4">
          <SettingsSwitcher />
          <SettingsPageHeader
            detail={
              <p className="text-caption text-muted-foreground">Developers</p>
            }
            title="Models"
          />
        </div>
        <ModelsPanel />
      </div>
    </SettingsChrome>
  );
}
