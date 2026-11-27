import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { createFileRoute } from "@tanstack/react-router";

import { OrgNetworkSection } from "../../features/developers/network-section";
import { DeveloperSettingsPage } from "../../features/settings/settings-widgets";

export const Route = createFileRoute("/developers/network")({
  component: DevelopersNetworkPage,
});

function DevelopersNetworkPage() {
  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <DeveloperSettingsPage title="Network">
        <OrgNetworkSection />
      </DeveloperSettingsPage>
    </ScrollArea>
  );
}
