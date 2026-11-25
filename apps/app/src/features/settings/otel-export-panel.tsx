"use client";

import { Button } from "@preprocess/ui/components/button";
import {
  AsyncActionAbortError,
  LoadingButton,
} from "@preprocess/ui/components/loading-button";
import { Switch } from "@preprocess/ui/components/switch";
import { Plus, XIcon } from "@preprocess/ui/lib/icons";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useOrganizationId } from "../auth/auth-context";
import { ApiError, orgApi } from "../auth/client";
import {
  SettingsCard,
  SettingsConfirmBody,
  SettingsDialog,
  SettingsError,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRowSkeleton,
  SettingsRows,
  SettingsSection,
  actionErrorMessage,
  formatRelative,
} from "./kit";
import { SettingsStacked } from "./settings-widgets";
import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";

/**
 * The organization's OpenTelemetry export (design doc 09): an OTLP/HTTP
 * endpoint that receives run logs and traces, the headers sent with them,
 * and a switch. Header values are write-only, so stored headers show only
 * their names and are replaced as a set. For Owners and Admins.
 */

type OtelExport = {
  endpoint: string;
  headers: string[];
  enabled: boolean;
  updatedBy: string;
  updatedAt: string;
};

type HeaderRow = { key: number; name: string; value: string };

type State =
  | { kind: "loading" }
  | { kind: "failed"; error: unknown }
  | { kind: "ready"; saved: OtelExport | null };

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

function validateEndpoint(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Enter your collector's URL.";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "Enter a full URL, like https://otel.example.com.";
  }
  return url.protocol === "https:" ? null : "The URL must start with https://.";
}

function validateHeaderName(value: string) {
  if (!value.trim()) return "Enter a header name.";
  return HEADER_NAME.test(value.trim())
    ? null
    : "Use letters, digits and - only.";
}

function validateHeaderValue(value: string) {
  return value ? null : "Enter the header's value.";
}

export function OtelExportPanel() {
  const organizationId = useOrganizationId();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    orgApi<OtelExport>(organizationId, "/settings/otel")
      .then(
        (saved) => saved,
        (error: unknown) => {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        },
      )
      .then((saved) => live && setState({ kind: "ready", saved }))
      .catch((error: unknown) => live && setState({ kind: "failed", error }));
    return () => {
      live = false;
    };
  }, [organizationId]);

  if (state.kind === "failed") return <SettingsError error={state.error} />;

  return (
    <SettingsStacked>
      <SettingsSection
        description="Send this organization's run logs and traces to your own OpenTelemetry collector over OTLP/HTTP. Logs go to /v1/logs and traces to /v1/traces under the URL."
        title="Collector"
      >
        {state.kind === "loading" ? (
          <SettingsRows>
            <SettingsRowSkeleton label="Endpoint" />
            <SettingsRowSkeleton label="Headers" />
          </SettingsRows>
        ) : (
          <OtelExportForm
            // A saved export starts a fresh form.
            key={state.saved?.updatedAt ?? "new"}
            onSaved={(saved) => setState({ kind: "ready", saved })}
            organizationId={organizationId}
            saved={state.saved}
          />
        )}
      </SettingsSection>
      {state.kind === "ready" && state.saved ? (
        <SettingsSection title="Remove export">
          <SettingsRows>
            <SettingsRow
              description="Stop sending logs and traces and delete the stored headers."
              label="Remove export"
            >
              <SettingsDialog
                description="Logs and traces stop going to this collector. Its headers are deleted and can't be recovered."
                title="Remove OpenTelemetry export"
                content={(close) => (
                  <SettingsConfirmBody
                    actionLabel="Remove"
                    onCancel={close}
                    onConfirm={async () => {
                      await orgApi(organizationId, "/settings/otel", {
                        method: "DELETE",
                      });
                      setState({ kind: "ready", saved: null });
                    }}
                    pendingLabel="Removing…"
                    successLabel="Removed"
                  />
                )}
              >
                <Button type="button" variant="secondary">
                  Remove
                </Button>
              </SettingsDialog>
            </SettingsRow>
          </SettingsRows>
        </SettingsSection>
      ) : null}
    </SettingsStacked>
  );
}

function OtelExportForm({
  organizationId,
  saved,
  onSaved,
}: Readonly<{
  organizationId: string;
  saved: OtelExport | null;
  onSaved: (saved: OtelExport) => void;
}>) {
  const [endpoint, setEndpoint] = useState(saved?.endpoint ?? "");
  const [enabled, setEnabled] = useState(saved?.enabled ?? true);
  // Stored values never come back, so changing headers replaces them all.
  const [replacing, setReplacing] = useState(saved === null);
  const [rows, setRows] = useState<HeaderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(0);
  const endpointRef = useRef<ValidatedFieldHandle>(null);
  const fieldRefs = useRef(new Map<string, ValidatedFieldHandle>());

  const addRow = (name = "") =>
    setRows((current) => [
      ...current,
      { key: nextKey.current++, name, value: "" },
    ]);
  const updateRow = (key: number, patch: Partial<HeaderRow>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  const field = (id: string) => (handle: ValidatedFieldHandle | null) => {
    if (handle) fieldRefs.current.set(id, handle);
    else fieldRefs.current.delete(id);
  };

  async function onSave() {
    setError(null);
    const valid = [endpointRef.current, ...fieldRefs.current.values()]
      .map((handle) => handle?.commit() ?? true)
      .every(Boolean);
    if (!valid) throw new AsyncActionAbortError();
    const names = rows.map((row) => row.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      setError("Each header can appear only once.");
      throw new AsyncActionAbortError();
    }
    try {
      onSaved(
        await orgApi<OtelExport>(organizationId, "/settings/otel", {
          method: "PUT",
          body: JSON.stringify({
            endpoint: endpoint.trim(),
            enabled,
            ...(replacing && {
              headers: Object.fromEntries(
                rows.map((row) => [row.name.trim(), row.value]),
              ),
            }),
          }),
        }),
      );
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not save the export."));
      throw cause;
    }
  }

  return (
    <SettingsCard>
      <form
        className="flex flex-col gap-5 p-5"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
        }}
      >
        <ValidatedField
          ref={endpointRef}
          hint="Your collector's OTLP/HTTP base URL. It must be public and use https."
          id="otel-endpoint"
          label="Endpoint"
          onChange={setEndpoint}
          placeholder="https://otel.example.com"
          type="url"
          validate={validateEndpoint}
          value={endpoint}
        />
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-body text-foreground">Headers</span>
            <span className="text-caption text-muted-foreground">
              {replacing
                ? "Sent with every export, such as your collector's API key. Values are stored encrypted and never shown again."
                : saved && saved.headers.length > 0
                  ? `Stored: ${saved.headers.join(", ")}. Values are hidden.`
                  : "None stored."}
            </span>
          </div>
          {replacing
            ? rows.map((row) => (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] items-start gap-3"
                  key={row.key}
                >
                  <ValidatedField
                    ref={field(`name-${row.key}`)}
                    autoComplete="off"
                    id={`otel-header-name-${row.key}`}
                    label="Name"
                    onChange={(name) => updateRow(row.key, { name })}
                    placeholder="Authorization"
                    validate={validateHeaderName}
                    value={row.name}
                  />
                  <ValidatedField
                    ref={field(`value-${row.key}`)}
                    autoComplete="off"
                    id={`otel-header-value-${row.key}`}
                    label="Value"
                    onChange={(value) => updateRow(row.key, { value })}
                    type="password"
                    validate={validateHeaderValue}
                    value={row.value}
                  />
                  <Button
                    aria-label="Remove header"
                    className="mt-6"
                    onClick={() =>
                      setRows((current) =>
                        current.filter((other) => other.key !== row.key),
                      )
                    }
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <XIcon size={16} />
                  </Button>
                </div>
              ))
            : null}
          <div className="flex gap-2">
            {replacing ? (
              <Button
                leadingIcon={Plus}
                onClick={() => addRow()}
                type="button"
                variant="secondary"
              >
                Add header
              </Button>
            ) : (
              <Button
                onClick={() => {
                  setReplacing(true);
                  for (const name of saved?.headers ?? []) addRow(name);
                }}
                type="button"
                variant="secondary"
              >
                {saved && saved.headers.length > 0
                  ? "Replace headers"
                  : "Add headers"}
              </Button>
            )}
          </div>
        </div>
        <Switch
          checked={enabled}
          label="Send logs and traces"
          onToggle={() => setEnabled((current) => !current)}
        />
        {error ? (
          <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
        ) : null}
        <div className="flex items-center justify-between gap-4">
          <span className="text-caption text-muted-foreground">
            {saved ? `Last changed ${formatRelative(saved.updatedAt)}` : null}
          </span>
          <div className="shrink-0">
            <LoadingButton
              onAction={onSave}
              pendingLabel="Saving…"
              successLabel="Saved"
              type="button"
            >
              Save
            </LoadingButton>
          </div>
        </div>
      </form>
    </SettingsCard>
  );
}
