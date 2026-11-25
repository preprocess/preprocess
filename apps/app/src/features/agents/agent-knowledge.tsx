import { SettingsEmpty, SettingsSection } from "../settings/kit";

// Sections of the agent page that have no real page yet: a title and what
// will show up there.
function Placeholder({
  title,
  description,
  emptyTitle,
  emptyDescription,
}: Readonly<{
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
}>) {
  return (
    <SettingsSection description={description} title={title}>
      <SettingsEmpty description={emptyDescription} title={emptyTitle} />
    </SettingsSection>
  );
}

/** Placeholder: what the agent keeps between cases. */
export function AgentMemories() {
  return (
    <Placeholder
      description="Facts and rules this agent keeps between cases, learned on a case or added by someone."
      emptyDescription="Memories the agent learns, or that you add, will show up here."
      emptyTitle="No memories yet"
      title="Memories"
    />
  );
}

/** Placeholder: the agent's datasets, training runs and fine-tuned models. */
export function AgentTraining() {
  return (
    <Placeholder
      description="Datasets built from this agent's reviewed cases, training runs, and the fine-tuned models they produce."
      emptyDescription="Training for this agent will show up here."
      emptyTitle="No training yet"
      title="Training"
    />
  );
}

/** Placeholder: the code and config each deployment was built from. */
export function AgentConfiguration() {
  return (
    <Placeholder
      description="The agent's definition and preprocess.config.json, as the production deployment was built."
      emptyDescription="The production deployment's configuration will show up here."
      emptyTitle="Nothing to show yet"
      title="Configuration"
    />
  );
}

/** Placeholder: every deployment, with promote and rollback. */
export function AgentDeployments() {
  return (
    <Placeholder
      description="Every push deploys: the production branch for production, other branches to previews."
      emptyDescription="This agent's deployments will show up here."
      emptyTitle="Nothing to show yet"
      title="Deployments"
    />
  );
}

/** Placeholder: which groups can see and operate the agent. */
export function AgentAccess() {
  return (
    <Placeholder
      description="Who can see this agent's cases and who can work them."
      emptyDescription="Group access for this agent will show up here. Groups are managed in Settings → Groups."
      emptyTitle="Nothing to show yet"
      title="Access"
    />
  );
}

/** Placeholder: the agent's effective settings and overrides. */
export function AgentSettings() {
  return (
    <Placeholder
      description="This agent's settings, where each one comes from, and its own overrides."
      emptyDescription="This agent's settings will show up here."
      emptyTitle="Nothing to show yet"
      title="Settings"
    />
  );
}
