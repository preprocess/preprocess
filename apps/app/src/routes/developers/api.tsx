import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { createFileRoute } from "@tanstack/react-router";

import { SettingsEmpty, SettingsSection } from "../../features/settings/kit";
import {
  DeveloperSettingsAction,
  DeveloperSettingsPage,
} from "../../features/settings/settings-widgets";

export const Route = createFileRoute("/developers/api")({
  component: DevelopersApiPage,
});

/** How outside code talks to Preprocess: keys to call in, webhooks to hear back. */
function DevelopersApiPage() {
  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <DeveloperSettingsPage title="Keys & webhooks">
        <DeveloperSettingsAction action="api-keys" />
        <SettingsSection
          description="Endpoints that hear about case changes as they happen."
          title="Webhooks"
        >
          <SettingsEmpty
            description="Webhook endpoints you add will show up here."
            title="No webhooks yet"
          />
        </SettingsSection>
      </DeveloperSettingsPage>
    </ScrollArea>
  );
}
