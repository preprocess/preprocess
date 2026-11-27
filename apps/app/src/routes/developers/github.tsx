import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { createFileRoute } from "@tanstack/react-router";

import { GitHubSettings } from "../../features/developers/github-section";
import { DeveloperSettingsPage } from "../../features/settings/settings-widgets";

export const Route = createFileRoute("/developers/github")({
  component: DevelopersGitHubPage,
});

/** Where pushes come from: the GitHub App and its repository links. */
function DevelopersGitHubPage() {
  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <DeveloperSettingsPage title="GitHub">
        <GitHubSettings />
      </DeveloperSettingsPage>
    </ScrollArea>
  );
}
