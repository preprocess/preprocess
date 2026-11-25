import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  CheckboxGroup,
  CheckboxItem,
} from "@preprocess/ui/components/checkbox-group";
import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import { InputCopy } from "@preprocess/ui/components/input-copy";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { Plus, X } from "@preprocess/ui/lib/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";

import { useOrganizationId } from "../auth/auth-context";
import { apiFetch, authPost, orgApi } from "../auth/client";
import {
  SettingsConfirmDialog,
  SettingsDialogActions,
  SettingsDialogShell,
  SettingsEmpty,
  SettingsError,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRowMenu,
  SettingsRows,
  SettingsSection,
  SettingsSkeletonRows,
  actionErrorMessage,
  formatRelative,
} from "../settings/kit";
import { useCanAdminister } from "../settings/use-role";
import { SettingsStacked } from "../settings/settings-widgets";

/**
 * Developers → Keys & webhooks: the organization's API keys (Better Auth's
 * API key plugin, under /api/auth) and its outbound webhook endpoints
 * (/v1/orgs/:org/webhooks). Owners and Admins manage both; a key and an
 * endpoint's signing secret are shown once, when they're made.
 */

type ApiKey = {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: string;
  lastRequest: string | null;
};

type Endpoint = {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  disabledReason: string | null;
  createdAt: string;
};

const EVENTS = [
  { value: "case.completed", label: "Case completed" },
  { value: "case.failed", label: "Case failed" },
  { value: "case.needs_group", label: "Case needs a group" },
] as const;

const eventLabel = (value: string) =>
  EVENTS.find((event) => event.value === value)?.label ?? value;

function validateKeyName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Name the key, like CI or Production deploys.";
  return trimmed.length > 64 ? "Keep the name under 64 characters." : null;
}

function validateWebhookUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Enter the URL to send events to.";
  try {
    return new URL(trimmed).protocol === "https:"
      ? null
      : "The URL must start with https://.";
  } catch {
    return "Enter a full URL, like https://example.com/hooks/preprocess.";
  }
}

function Name({ children }: Readonly<{ children: string }>) {
  return (
    <span
      className="truncate text-body text-foreground"
      style={{ fontVariationSettings: fontWeights.semibold }}
    >
      {children}
    </span>
  );
}

/** A secret shown once, with a copy field and the warning that goes with it. */
function OnceSecret({
  label,
  value,
  onDone,
}: Readonly<{ label: string; value: string; onDone: () => void }>) {
  return (
    <div className="flex flex-col gap-4">
      <InputCopy label={label} value={value} />
      <SettingsPanelMessage>
        Copy it now. It won't be shown again.
      </SettingsPanelMessage>
      <div className="flex justify-end">
        <Button onClick={onDone} type="button">
          Done
        </Button>
      </div>
    </div>
  );
}

export function KeysAndWebhooks() {
  const canAdminister = useCanAdminister();
  if (!canAdminister)
    return (
      <SettingsEmpty
        description="Only Owners and Admins can create API keys and webhook endpoints. Ask one of them if you need a key."
        title="Ask an Owner or Admin"
      />
    );
  return (
    <SettingsStacked>
      <ApiKeysSection />
      <WebhooksSection />
    </SettingsStacked>
  );
}

function ApiKeysSection() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const queryKey = ["api-keys", organizationId];
  const keys = useQuery({
    queryKey,
    queryFn: () =>
      apiFetch<{ apiKeys: ApiKey[] }>(
        `/api/auth/api-key/list?organizationId=${encodeURIComponent(organizationId)}&sortBy=createdAt&sortDirection=desc`,
      ).then((body) => body.apiKeys),
  });
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const refreshLater = () => void refresh();

  return (
    <SettingsSection
      actions={
        <Button
          leadingIcon={Plus}
          onClick={() => setCreating(true)}
          size="compact"
          type="button"
          variant="secondary"
        >
          Create key
        </Button>
      }
      description="Keys that let your code, the CLI and MCP clients call the Preprocess API for this organization."
      title="API keys"
    >
      {keys.isError ? (
        <SettingsError error={keys.error} />
      ) : keys.data === undefined ? (
        <SettingsSkeletonRows count={2} />
      ) : keys.data.length === 0 ? (
        <SettingsEmpty
          description="Create a key for the CLI, CI or an MCP client."
          title="No API keys yet"
        />
      ) : (
        <SettingsRows>
          {keys.data.map((key) => (
            <SettingsRow
              description={[
                key.start ? `${key.start}…` : null,
                `Created ${formatRelative(key.createdAt)}`,
                key.lastRequest
                  ? `Last used ${formatRelative(key.lastRequest)}`
                  : "Never used",
              ]
                .filter(Boolean)
                .join(" · ")}
              key={key.id}
              label={<Name>{key.name ?? "Unnamed key"}</Name>}
            >
              <SettingsRowMenu
                actions={[
                  {
                    label: "Revoke",
                    icon: X,
                    onSelect: () => setRevoking(key),
                  },
                ]}
                label={`Actions for ${key.name ?? "key"}`}
              />
            </SettingsRow>
          ))}
        </SettingsRows>
      )}
      <CreateKeyDialog
        onCreated={refreshLater}
        onOpenChange={setCreating}
        open={creating}
        organizationId={organizationId}
      />
      <SettingsConfirmDialog
        confirmLabel="Revoke"
        description="Anything using this key stops working at once. This can't be undone."
        onConfirm={async () => {
          if (!revoking) return;
          await authPost("/api-key/delete", { keyId: revoking.id });
          await refresh();
        }}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        open={revoking !== null}
        pendingLabel="Revoking…"
        successLabel="Revoked"
        title={`Revoke ${revoking?.name ?? "this key"}?`}
      />
    </SettingsSection>
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
  organizationId,
  onCreated,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  onCreated: () => void;
}>) {
  const nameRef = useRef<InlineValidationHandle>(null);
  const createRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    onOpenChange(false);
    setName("");
    setSecret(null);
    setError(null);
  };

  async function create() {
    setError(null);
    if (!nameRef.current?.commit()) throw new AsyncActionAbortError();
    try {
      const created = await authPost<{ key: string }>("/api-key/create", {
        name: name.trim(),
        organizationId,
      });
      setSecret(created.key);
      onCreated();
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not create the key."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      description={
        secret
          ? "Use it as a bearer token, or set it as PREPROCESS_API_KEY for the CLI."
          : "The key acts for this organization, not for you, and its actions are recorded as the key's."
      }
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      open={open}
      title={secret ? "Your new API key" : "Create API key"}
    >
      {secret ? (
        <OnceSecret label="API key" onDone={close} value={secret} />
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            createRef.current?.run();
          }}
        >
          <InlineValidation
            autoFocus
            hint="Say where it's used, so you know what breaks if you revoke it."
            id="api-key-name"
            label="Name"
            onChange={setName}
            placeholder="CI"
            ref={nameRef}
            validate={validateKeyName}
            value={name}
          />
          {error ? (
            <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
          ) : null}
          <SettingsDialogActions onCancel={close} pending={pending}>
            <LoadingButton
              onAction={create}
              onStatusChange={(status) => setPending(status === "pending")}
              pendingLabel="Creating…"
              ref={createRef}
              successLabel="Created"
              type="submit"
            >
              Create key
            </LoadingButton>
          </SettingsDialogActions>
        </form>
      )}
    </SettingsDialogShell>
  );
}

function WebhooksSection() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const queryKey = ["webhooks", organizationId];
  const endpoints = useQuery({
    queryKey,
    queryFn: () => orgApi<Endpoint[]>(organizationId, "/webhooks"),
  });
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Endpoint | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const refreshLater = () => void refresh();

  return (
    <SettingsSection
      actions={
        <Button
          leadingIcon={Plus}
          onClick={() => setAdding(true)}
          size="compact"
          type="button"
          variant="secondary"
        >
          Add endpoint
        </Button>
      }
      description="Endpoints that hear about case changes as they happen. Each delivery is signed with the endpoint's secret."
      title="Webhooks"
    >
      {endpoints.isError ? (
        <SettingsError error={endpoints.error} />
      ) : endpoints.data === undefined ? (
        <SettingsSkeletonRows count={2} />
      ) : endpoints.data.length === 0 ? (
        <SettingsEmpty
          description="Add an endpoint to hear when cases complete, fail or need a group."
          title="No webhooks yet"
        />
      ) : (
        <SettingsRows>
          {endpoints.data.map((endpoint) => (
            <SettingsRow
              description={
                endpoint.enabled
                  ? endpoint.events.map(eventLabel).join(", ")
                  : (endpoint.disabledReason ?? "Turned off")
              }
              key={endpoint.id}
              label={<Name>{endpoint.url}</Name>}
            >
              {endpoint.enabled ? null : (
                <Badge className="shrink-0" size="sm">
                  Off
                </Badge>
              )}
              <SettingsRowMenu
                actions={[
                  {
                    label: "Delete",
                    icon: X,
                    onSelect: () => setDeleting(endpoint),
                  },
                ]}
                label={`Actions for ${endpoint.url}`}
              />
            </SettingsRow>
          ))}
        </SettingsRows>
      )}
      <AddEndpointDialog
        onAdded={refreshLater}
        onOpenChange={setAdding}
        open={adding}
        organizationId={organizationId}
      />
      <SettingsConfirmDialog
        confirmLabel="Delete"
        description="Events stop going to this URL, and its delivery history is deleted."
        onConfirm={async () => {
          if (!deleting) return;
          await orgApi(organizationId, `/webhooks/${deleting.id}`, {
            method: "DELETE",
          });
          await refresh();
        }}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        open={deleting !== null}
        pendingLabel="Deleting…"
        successLabel="Deleted"
        title="Delete this endpoint?"
      />
    </SettingsSection>
  );
}

function AddEndpointDialog({
  open,
  onOpenChange,
  organizationId,
  onAdded,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  onAdded: () => void;
}>) {
  const urlRef = useRef<InlineValidationHandle>(null);
  const addRef = useRef<LoadingButtonHandle>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(
    EVENTS.map((event) => event.value),
  );
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    onOpenChange(false);
    setUrl("");
    setEvents(EVENTS.map((event) => event.value));
    setSecret(null);
    setError(null);
  };

  async function add() {
    setError(null);
    if (!urlRef.current?.commit()) throw new AsyncActionAbortError();
    if (events.length === 0) {
      setError("Choose at least one event.");
      throw new AsyncActionAbortError();
    }
    try {
      const created = await orgApi<{ signingSecret: string }>(
        organizationId,
        "/webhooks",
        {
          method: "POST",
          body: JSON.stringify({ url: url.trim(), events }),
        },
      );
      setSecret(created.signingSecret);
      onAdded();
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not add the endpoint."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      description={
        secret
          ? "Check each delivery's signature with this secret before you trust it."
          : "Preprocess sends a signed POST to this URL for each event you choose."
      }
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      open={open}
      title={secret ? "Your signing secret" : "Add webhook endpoint"}
    >
      {secret ? (
        <OnceSecret label="Signing secret" onDone={close} value={secret} />
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            addRef.current?.run();
          }}
        >
          <InlineValidation
            autoFocus
            hint="A public https URL."
            id="webhook-url"
            label="URL"
            onChange={setUrl}
            placeholder="https://example.com/hooks/preprocess"
            ref={urlRef}
            type="url"
            validate={validateWebhookUrl}
            value={url}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-body text-foreground">Events</span>
            <CheckboxGroup
              checkedIndices={
                new Set(
                  EVENTS.flatMap((event, index) =>
                    events.includes(event.value) ? [index] : [],
                  ),
                )
              }
            >
              {EVENTS.map((event, index) => (
                <CheckboxItem
                  checked={events.includes(event.value)}
                  index={index}
                  key={event.value}
                  label={event.label}
                  onToggle={() =>
                    setEvents((current) =>
                      current.includes(event.value)
                        ? current.filter((value) => value !== event.value)
                        : [...current, event.value],
                    )
                  }
                />
              ))}
            </CheckboxGroup>
          </div>
          {error ? (
            <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
          ) : null}
          <SettingsDialogActions onCancel={close} pending={pending}>
            <LoadingButton
              onAction={add}
              onStatusChange={(status) => setPending(status === "pending")}
              pendingLabel="Adding…"
              ref={addRef}
              successLabel="Added"
              type="submit"
            >
              Add endpoint
            </LoadingButton>
          </SettingsDialogActions>
        </form>
      )}
    </SettingsDialogShell>
  );
}
