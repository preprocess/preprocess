import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import {
  clearSandboxImage,
  sandboxImageUsage,
} from "../../features/agents/agent-store";
import {
  addSandboxImage,
  getPlatformSettings,
  removeSandboxImage,
  setDefaultSandboxImage,
} from "../../features/developers/platform-store";
import { SandboxImagesSection } from "../../features/developers/sandbox-images-section";
import { DeveloperSettingsPage } from "../../features/settings/settings-widgets";

export const Route = createFileRoute("/developers/sandboxes")({
  loader: async () => {
    const settings = await getPlatformSettings();
    const byImage = sandboxImageUsage();
    // Agents with no image of their own run on the default.
    const usage = new Map(
      settings.images.map((image) => [
        image.id,
        (byImage.get(image.id) ?? 0) +
          (image.id === settings.defaultImageId ? (byImage.get(null) ?? 0) : 0),
      ]),
    );
    return { ...settings, usage };
  },
  component: DevelopersSandboxesPage,
});

function DevelopersSandboxesPage() {
  const { images, defaultImageId, usage } = Route.useLoaderData();
  const router = useRouter();
  const refresh = () => router.invalidate();

  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <DeveloperSettingsPage title="Sandbox images">
        <SandboxImagesSection
          defaultImageId={defaultImageId}
          images={images}
          onAdd={async (repository, tag) => {
            await addSandboxImage(repository, tag);
            await refresh();
          }}
          onRemove={async (id) => {
            await removeSandboxImage(id);
            await clearSandboxImage(id);
            await refresh();
          }}
          onSetDefault={async (id) => {
            await setDefaultSandboxImage(id);
            await refresh();
          }}
          usage={usage}
        />
      </DeveloperSettingsPage>
    </ScrollArea>
  );
}
