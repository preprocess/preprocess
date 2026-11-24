import {
  AsyncActionAbortError,
  LoadingButton,
} from "@preprocess/ui/components/loading-button";
import { useState } from "react";

import {
  SettingsDialogActions,
  SettingsDialogShell,
  SettingsFileDrop,
  type SettingsAttemptError,
} from "../settings/kit";
import { shortDeploymentId, type AgentDeployment } from "./agent-store";

const INPUT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "message/rfc822",
] as const;

/**
 * What a developer pastes to aim local tests at one deployment: the SDK and
 * CLI read PREPROCESS_DEPLOYMENT and send it as the Preprocess-Deployment
 * header. A preview follows its branch, so the command stays valid across
 * pushes; production needs no header.
 */
export function deploymentTestCommand(
  deployment: AgentDeployment,
  production: boolean,
) {
  return production
    ? "pnpm test"
    : `PREPROCESS_DEPLOYMENT=branch:${deployment.branch} pnpm test`;
}

/**
 * Start a case on one deployment from an uploaded input. A run on a preview
 * is a preview case: it shows under Cases → Previews, reaches nobody's inbox,
 * and its success step only records what it would do. No backend yet, so
 * the run is acknowledged and nothing starts.
 */
export function RunCaseDialog({
  deployment,
  production,
  onOpenChange,
}: Readonly<{
  deployment: AgentDeployment;
  production: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<SettingsAttemptError | null>(null);
  const [pending, setPending] = useState(false);
  const id = shortDeploymentId(deployment.id);

  return (
    <SettingsDialogShell
      description={
        production
          ? `Runs on ${id}, the production deployment, as a normal case.`
          : `Runs on ${id} as a preview case: it stays out of everyone's inbox and its success step only records what it would do.`
      }
      onOpenChange={onOpenChange}
      open
      title={`Run a case on ${id}`}
    >
      <div className="flex flex-col gap-4">
        <SettingsFileDrop
          accept={INPUT_TYPES}
          error={error}
          file={file}
          hint="A document, image, email, or text file."
          label="Input"
          onFileChange={(next) => {
            setFile(next);
            setError(null);
          }}
        />
        <SettingsDialogActions
          onCancel={() => onOpenChange(false)}
          pending={pending}
        >
          <LoadingButton
            onAction={async () => {
              if (!file) {
                setError({ message: "Add an input to run.", at: Date.now() });
                throw new AsyncActionAbortError();
              }
              await new Promise((resolve) => window.setTimeout(resolve, 400));
              window.setTimeout(() => onOpenChange(false), 600);
            }}
            onStatusChange={(status) => setPending(status === "pending")}
            pendingLabel="Starting…"
            successLabel="Started"
          >
            Run case
          </LoadingButton>
        </SettingsDialogActions>
      </div>
    </SettingsDialogShell>
  );
}
