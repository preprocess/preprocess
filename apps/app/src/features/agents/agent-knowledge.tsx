import type { ReactNode } from "react";

import { ComingSoonArt } from "../../components/empty-art";
import { SettingsEmpty, SettingsSection } from "../settings/kit";

// Sections of the agent page that have no real page yet: a title and what
// will show up there.
function Placeholder({
  title,
  description,
  emptyTitle,
  emptyDescription,
  actions,
}: Readonly<{
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  actions?: ReactNode;
}>) {
  return (
    <SettingsSection actions={actions} description={description} title={title}>
      <SettingsEmpty
        art={<ComingSoonArt />}
        description={emptyDescription}
        title={emptyTitle}
      />
    </SettingsSection>
  );
}

/** Placeholder: the code and config each deployment was built from. */
export function AgentConfiguration() {
  return (
    <Placeholder
      description="The agent's definition and preprocess.config.json, as the production deployment was built."
      emptyDescription="Agent settings live in your code and preprocess.config.json today."
      emptyTitle="Configuration is coming soon"
      title="Configuration"
    />
  );
}

/** Placeholder: which groups can see and operate the agent. */
export function AgentAccess() {
  return (
    <Placeholder
      description="Who can see this agent's cases and who can work them."
      emptyDescription="Manage which groups can work or view this agent in Settings → Organization → Groups."
      emptyTitle="Access view is coming soon"
      title="Access"
    />
  );
}
