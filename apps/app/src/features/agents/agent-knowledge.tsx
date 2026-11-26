import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";

import type { ReactNode } from "react";

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
      <SettingsEmpty description={emptyDescription} title={emptyTitle} />
    </SettingsSection>
  );
}

/** Placeholder: the agent's datasets, training runs and fine-tuned models.
 *  Training runs and Retrain on corrections are Coming soon (spec 12a). */
export function AgentTraining() {
  return (
    <Placeholder
      actions={
        <>
          <Badge color="gray" size="sm">
            Coming soon
          </Badge>
          <Button disabled variant="secondary">
            Retrain on corrections
          </Button>
        </>
      }
      description="Datasets built from this agent's reviewed cases, training runs, and the fine-tuned models they produce."
      emptyDescription="Captured cases and review events are already being collected for training, so they will be ready when training runs ship."
      emptyTitle="Training is coming soon"
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
