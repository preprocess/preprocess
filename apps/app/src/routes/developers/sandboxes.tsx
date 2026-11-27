import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { SandboxesOverview } from "../../features/developers/sandboxes-overview";
import { DeveloperSettingsPage } from "../../features/settings/settings-widgets";

const loadDocsUrl = createServerFn({ method: "GET" }).handler(async () => {
  const { docsUrl } = await import("../../server/run-mode.server");
  return docsUrl();
});

export const Route = createFileRoute("/developers/sandboxes")({
  loader: () => loadDocsUrl(),
  component: DevelopersSandboxesPage,
});

function DevelopersSandboxesPage() {
  const docsUrl = Route.useLoaderData();
  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <DeveloperSettingsPage title="Sandboxes">
        <SandboxesOverview docsUrl={docsUrl} />
      </DeveloperSettingsPage>
    </ScrollArea>
  );
}
