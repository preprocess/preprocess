import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { agentEnvKeys } from "../../features/agents/agent-store";
import {
  deleteOrgSecret,
  getPlatformSettings,
  setOrgSecret,
} from "../../features/developers/platform-store";
import { SecretsSection } from "../../features/developers/secret-list";
import { DeveloperSettingsPage } from "../../features/settings/settings-widgets";

export const Route = createFileRoute("/developers/secrets")({
  loader: async () => ({
    secrets: (await getPlatformSettings()).secrets,
    agentKeys: agentEnvKeys(),
  }),
  component: DevelopersSecretsPage,
});

function DevelopersSecretsPage() {
  const { secrets, agentKeys } = Route.useLoaderData();
  const router = useRouter();

  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <DeveloperSettingsPage title="Secrets">
        <SecretsSection
          // An agent variable with the same key would be shadowed, and
          // agents never get overridden quietly; rename one of them first.
          conflict={(key) => {
            const agents = agentKeys.get(key);
            return agents
              ? `${agents.join(", ")} already ${agents.length === 1 ? "sets" : "set"} ${key}; rename or remove it there first.`
              : null;
          }}
          description="Available to every agent's deployed code. Agents can't override them."
          items={secrets}
          noun="secret"
          onDelete={async (key) => {
            await deleteOrgSecret(key);
            await router.invalidate();
          }}
          onSave={async (key, value, scope) => {
            await setOrgSecret(key, value, scope);
            await router.invalidate();
          }}
        />
      </DeveloperSettingsPage>
    </ScrollArea>
  );
}
