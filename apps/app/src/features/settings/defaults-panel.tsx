"use client";

// Organization defaults (spec 5): the values an agent's settings fall back to
// when neither its code nor a dashboard override sets them. Owners and Admins
// change them; everyone else reads them.

import { LoadingButton } from "@preprocess/ui/components/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useOrganizationId } from "../auth/auth-context";
import { orgApi } from "../auth/client";
import {
  actionErrorMessage,
  SettingsTextField,
  SettingsError,
  SettingsRows,
  SettingsRow,
  SettingsSection,
  SettingsSkeletonRows,
} from "./kit";
import { SettingsStacked } from "./settings-widgets";
import { useCanAdminister } from "./use-role";

type Defaults = {
  model?: string;
  reasoning?: string;
  ocr?: boolean;
  timeoutSeconds?: number;
  toolRetries?: number;
  sandboxImage?: string;
  "evals.onPush"?: boolean;
};

type Key = keyof Defaults;

// Empty is the platform's own default.
type Draft = Record<Key, string>;

type Field = {
  key: Key;
  label: string;
  description: string;
} & (
  | { kind: "choice"; options: readonly { value: string; label: string }[] }
  | { kind: "number" | "text"; placeholder: string }
);

const BOOLEAN = [
  { value: "true", label: "On" },
  { value: "false", label: "Off" },
] as const;

const FIELDS: readonly Field[] = [
  {
    key: "model",
    label: "Model",
    description: "Platform default: Inkling 2 Small",
    kind: "choice",
    options: [
      { value: "inkling-2-mini", label: "Inkling 2 Mini" },
      { value: "inkling-2-small", label: "Inkling 2 Small" },
      { value: "kimi-k3.1-pro", label: "Kimi K3.1 Pro" },
    ],
  },
  {
    key: "reasoning",
    label: "Reasoning",
    description: "Platform default: medium",
    kind: "choice",
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
  },
  {
    key: "ocr",
    label: "OCR files before a case runs",
    description: "Platform default: off",
    kind: "choice",
    options: BOOLEAN,
  },
  {
    key: "timeoutSeconds",
    label: "Timeout",
    description: "Seconds a run may take",
    kind: "number",
    placeholder: "Platform default",
  },
  {
    key: "toolRetries",
    label: "Tool retries",
    description: "Retries after a tool call fails",
    kind: "number",
    placeholder: "Platform default",
  },
  {
    key: "sandboxImage",
    label: "Sandbox image",
    description: "The image agent code runs in",
    kind: "text",
    placeholder: "Platform default",
  },
  {
    key: "evals.onPush",
    label: "Run evals on push",
    description: "Platform default: off",
    kind: "choice",
    options: BOOLEAN,
  },
];

const PLATFORM = "platform";

const toDraft = (defaults: Defaults): Draft =>
  Object.fromEntries(
    FIELDS.map((f) => [f.key, defaults[f.key]?.toString() ?? ""]),
  ) as Draft;

const toValue = (field: Field, text: string) => {
  if (text === "") return null;
  if (field.kind === "number") return Number(text);
  if (text === "true" || text === "false") return text === "true";
  return text;
};

export function DefaultsPanel() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const canEdit = useCanAdminister();
  const defaults = useQuery({
    queryKey: ["defaults", organizationId],
    queryFn: () => orgApi<Defaults>(organizationId, "/defaults"),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (defaults.data) setDraft(toDraft(defaults.data));
  }, [defaults.data]);

  if (defaults.isError) return <SettingsError error={defaults.error} />;

  const saved = defaults.data ? toDraft(defaults.data) : null;
  const changed = FIELDS.filter(
    (f) => draft && saved && draft[f.key] !== saved[f.key],
  );
  const invalid = FIELDS.filter(
    (f) => f.kind === "number" && draft?.[f.key] && !/^\d+$/.test(draft[f.key]),
  );

  return (
    <SettingsStacked>
      <SettingsSection
        actions={
          canEdit ? (
            <LoadingButton
              disabled={changed.length === 0}
              onAction={async () => {
                if (!draft) return;
                if (invalid.length)
                  throw new Error(
                    `${invalid.map((f) => f.label).join(", ")} must be a whole number.`,
                  );
                await orgApi(organizationId, "/defaults", {
                  method: "PATCH",
                  body: JSON.stringify(
                    Object.fromEntries(
                      changed.map((f) => [f.key, toValue(f, draft[f.key])]),
                    ),
                  ),
                });
                await queryClient.invalidateQueries({
                  queryKey: ["defaults", organizationId],
                });
              }}
              onError={setError}
              onStatusChange={(status) => {
                if (status === "pending") setError(null);
              }}
            >
              Save
            </LoadingButton>
          ) : null
        }
        description="An agent uses these when its code and the dashboard leave a setting unset. Code always wins at deploy."
      >
        {draft ? (
          <SettingsRows>
            {FIELDS.map((field) => (
              <SettingsRow
                description={field.description}
                key={field.key}
                label={field.label}
                value={
                  <DefaultField
                    disabled={!canEdit}
                    field={field}
                    onChange={(text) =>
                      setDraft({ ...draft, [field.key]: text })
                    }
                    value={draft[field.key]}
                  />
                }
              />
            ))}
          </SettingsRows>
        ) : (
          <SettingsSkeletonRows count={FIELDS.length} />
        )}
        {error ? (
          <p className="text-caption text-destructive" role="alert">
            {actionErrorMessage(error, "Could not save the defaults.")}
          </p>
        ) : null}
      </SettingsSection>
    </SettingsStacked>
  );
}

function DefaultField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: Field;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  if (field.kind === "choice")
    return (
      <Select
        disabled={disabled}
        onValueChange={(next) => onChange(next === PLATFORM ? "" : next)}
        value={value || PLATFORM}
      >
        <SelectTrigger aria-label={field.label} className="w-52" />
        <SelectContent>
          <SelectItem index={0} value={PLATFORM}>
            Platform default
          </SelectItem>
          {field.options.map((option, index) => (
            <SelectItem
              index={index + 1}
              key={option.value}
              value={option.value}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  return (
    <SettingsTextField
      aria-label={field.label}
      className="w-52"
      disabled={disabled}
      inputMode={field.kind === "number" ? "numeric" : undefined}
      onChange={(event) => onChange(event.target.value.trim())}
      placeholder={field.placeholder}
      value={value}
    />
  );
}
