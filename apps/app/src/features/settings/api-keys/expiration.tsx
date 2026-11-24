"use client";

// Expiration choices and labels, ported from the WorkOS api-key-expiration
// widget: a fixed set of presets, plus the key's current expiration while
// editing.

import { Button } from "@preprocess/ui/components/button";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { useState } from "react";

import { SettingsDialogShell } from "../kit";
import {
  formatExpiresAt,
  useEditApiKeyExpiration,
  type ApiKey,
  type ApiKeyScope,
} from "./data";
import { ActionErrorBanner } from "./parts";

export type ExpirationOption =
  "never" | "1_hour" | "24_hours" | "3_days" | "7_days" | "current";

type ExpirationPreset = Exclude<ExpirationOption, "current">;

const PRESETS: readonly ExpirationPreset[] = [
  "never",
  "1_hour",
  "24_hours",
  "3_days",
  "7_days",
];

const PRESET_LABEL: Record<ExpirationPreset, string> = {
  never: "Never",
  "1_hour": "in 1 hour",
  "24_hours": "in 24 hours",
  "3_days": "in 3 days",
  "7_days": "in 7 days",
};

const HOUR = 60 * 60 * 1000;
const PRESET_MS: Record<Exclude<ExpirationPreset, "never">, number> = {
  "1_hour": HOUR,
  "24_hours": 24 * HOUR,
  "3_days": 3 * 24 * HOUR,
  "7_days": 7 * 24 * HOUR,
};

/** null for never; undefined for "keep the current expiration". */
export function expiresAtFor(
  option: ExpirationOption,
  now = new Date(),
): string | null | undefined {
  if (option === "never") return null;
  if (option === "current") return undefined;
  return new Date(now.getTime() + PRESET_MS[option]).toISOString();
}

export function ExpirationSelect({
  value,
  onValueChange,
  currentExpiresAt,
}: {
  value: ExpirationOption;
  onValueChange: (value: ExpirationOption) => void;
  currentExpiresAt?: string | null;
}) {
  const options: { value: ExpirationOption; label: string }[] = [
    ...(currentExpiresAt
      ? [
          {
            value: "current" as const,
            label: `Current Expiration - ${formatExpiresAt(currentExpiresAt)}`,
          },
        ]
      : []),
    ...PRESETS.map((preset) => ({
      value: preset,
      label: PRESET_LABEL[preset],
    })),
  ];

  return (
    <div className="flex flex-col gap-2">
      <span
        className="text-body text-foreground"
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        Expiration
      </span>
      <Select
        name="expiration"
        onValueChange={(next) => onValueChange(next as ExpirationOption)}
        value={value}
      >
        <SelectTrigger placeholder="Expiration" />
        <SelectContent>
          {options.map((option, index) => (
            <SelectItem index={index} key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function EditExpirationDialog({
  apiKey,
  scope,
  open,
  onOpenChange,
}: {
  apiKey: ApiKey;
  scope: ApiKeyScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <SettingsDialogShell
      onOpenChange={onOpenChange}
      open={open}
      title="Edit secret key expiration"
    >
      {open ? (
        <EditExpirationForm
          apiKey={apiKey}
          close={() => onOpenChange(false)}
          scope={scope}
        />
      ) : null}
    </SettingsDialogShell>
  );
}

function EditExpirationForm({
  apiKey,
  scope,
  close,
}: {
  apiKey: ApiKey;
  scope: ApiKeyScope;
  close: () => void;
}) {
  const initial: ExpirationOption = apiKey.expiresAt ? "current" : "never";
  const [selected, setSelected] = useState<ExpirationOption>(initial);
  const editExpiration = useEditApiKeyExpiration(scope);
  const isCurrent = selected === "current";
  const canSave = !isCurrent && selected !== initial;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-muted-foreground">
        {isCurrent
          ? "Confirm API key expiration. Once this key expires, you can no longer use it."
          : `Set API Key expiration for ${apiKey.name}. Once this key expires, you can no longer use it.`}
      </p>
      {editExpiration.error ? (
        <ActionErrorBanner>
          An error occurred while updating the API key expiration.
        </ActionErrorBanner>
      ) : null}
      <ExpirationSelect
        currentExpiresAt={apiKey.expiresAt}
        onValueChange={(next) => {
          if (!editExpiration.isPending) editExpiration.reset();
          setSelected(next);
        }}
        value={selected}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button
          disabled={editExpiration.isPending}
          onClick={close}
          type="button"
          variant="secondary"
        >
          Cancel
        </Button>
        <LoadingButton
          disabled={!canSave}
          onAction={async () => {
            const expiresAt = expiresAtFor(selected);
            if (expiresAt === undefined) return;
            await editExpiration.mutateAsync({
              apiKeyId: apiKey.id,
              expiresAt,
            });
          }}
          onStatusChange={(status) => {
            if (status === "success") window.setTimeout(close, 600);
          }}
          pendingLabel="Saving…"
          successLabel="Saved"
        >
          Save changes
        </LoadingButton>
      </div>
    </div>
  );
}
