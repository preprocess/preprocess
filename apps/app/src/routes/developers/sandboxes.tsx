import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { createFileRoute } from "@tanstack/react-router";

import { SandboxesOverview } from "../../features/developers/sandboxes-overview";
import { DeveloperSettingsPage } from "../../features/settings/settings-widgets";

export const Route = createFileRoute("/developers/sandboxes")({
  component: DevelopersSandboxesPage,
});

function DevelopersSandboxesPage() {
  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <DeveloperSettingsPage title="Sandboxes">
        <SandboxesOverview />
      </DeveloperSettingsPage>
    </ScrollArea>
  );
}
