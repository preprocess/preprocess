import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { OrgNetworkSection } from "../../features/developers/network-section";
import {
  deleteOrgNetworkRule,
  getPlatformSettings,
  setOrgNetworkRule,
} from "../../features/developers/platform-store";
import { DeveloperSettingsPage } from "../../features/settings/settings-widgets";

export const Route = createFileRoute("/developers/network")({
  loader: async () => (await getPlatformSettings()).network,
  component: DevelopersNetworkPage,
});

function DevelopersNetworkPage() {
  const rules = Route.useLoaderData();
  const router = useRouter();

  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <DeveloperSettingsPage title="Network">
        <OrgNetworkSection
          onAdd={async (rule) => {
            await setOrgNetworkRule(rule);
            await router.invalidate();
          }}
          onDelete={async (pattern) => {
            await deleteOrgNetworkRule(pattern);
            await router.invalidate();
          }}
          rules={rules}
        />
      </DeveloperSettingsPage>
    </ScrollArea>
  );
}
