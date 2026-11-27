import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { createFileRoute } from "@tanstack/react-router";

import { SecretsSection } from "../../features/developers/secret-list";
import { DeveloperSettingsPage } from "../../features/settings/settings-widgets";

export const Route = createFileRoute("/developers/secrets")({
  component: DevelopersSecretsPage,
});

function DevelopersSecretsPage() {
  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <DeveloperSettingsPage title="Secrets">
        <SecretsSection />
      </DeveloperSettingsPage>
    </ScrollArea>
  );
}
