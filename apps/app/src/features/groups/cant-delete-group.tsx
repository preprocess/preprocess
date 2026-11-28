import { Button } from "@preprocess/ui/components/button";

import { SettingsDialogShell } from "../settings/kit";

/** A live deployment whose code names a group (GET /groups/{group}). */
export type NamingDeployment = {
  readonly agentSlug: string;
  readonly environment: "production" | "preview";
};

const ENVIRONMENT = { production: "Production", preview: "Preview" } as const;

/**
 * Why a group can't be deleted yet: live deployments still name it. Shown
 * instead of the delete confirmation, on Groups and on Directory sync.
 */
export function CantDeleteGroupDialog({
  open,
  onOpenChange,
  name,
  namedBy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  namedBy: readonly NamingDeployment[];
}) {
  return (
    <SettingsDialogShell
      description="These live deployments still use this group. Remove it from their code and redeploy, then delete the group."
      footer={
        <Button
          onClick={() => onOpenChange(false)}
          type="button"
          variant="secondary"
        >
          Close
        </Button>
      }
      onOpenChange={onOpenChange}
      open={open}
      title={`Can't delete ${name}`}
    >
      <ul className="flex flex-col divide-y divide-border/60">
        {namedBy.map((deployment) => (
          <li
            className="min-w-0 truncate py-2.5 text-body text-foreground"
            key={`${deployment.agentSlug}:${deployment.environment}`}
          >
            {deployment.agentSlug} · {ENVIRONMENT[deployment.environment]}
          </li>
        ))}
      </ul>
    </SettingsDialogShell>
  );
}
