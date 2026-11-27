import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  CheckboxGroup,
  CheckboxItem,
} from "@preprocess/ui/components/checkbox-group";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { Pencil, Plus, Users, X } from "@preprocess/ui/lib/icons";
import {
  RESERVED_BINDINGS,
  RESERVED_PREFIX,
  SECRET_NAME,
} from "@preprocess/sdk/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";

import { NoAccessArt, NothingCreatedArt } from "../../components/empty-art";

import { useOrganizationId } from "../auth/auth-context";
import { orgApi } from "../auth/client";
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
import { useAdministers } from "../settings/use-role";
import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";

/**
 * Developers → Secrets: the organization's secrets (/v1/orgs/:org/secrets).
 * Values are write-only. Which agents' code receives each one is a
 * guardrail an Owner or Admin sets here; agents themselves never read them.
 */

type Secret = {
  name: string;
  version: number;
  updatedAt: string;
  /** Slugs of the agents granted this secret. */
  agents: string[];
  /** Live deployments whose code receives it. */
  live: number;
};

type Agent = { slug: string; archived: boolean };

const MASK = "••••••••";

function validateName(value: string) {
  const name = value.trim();
  if (!name) return "Enter a name, like API_TOKEN.";
  if (!SECRET_NAME.test(name)) {
    return "Use up to 64 capital letters, numbers, and underscores, starting with a letter.";
  }
  if (
    (RESERVED_BINDINGS as readonly string[]).includes(name) ||
    name.startsWith(RESERVED_PREFIX)
  ) {
    return `${name} is reserved by Preprocess; choose another name.`;
  }
  return null;
}

function validateValue(value: string) {
  if (value.length === 0) return "Enter a value.";
  return value.length > 5120 ? "Values can be up to 5,120 characters." : null;
}

function grantSummary(secret: Secret) {
  if (secret.agents.length === 0) return "No agents";
  if (secret.agents.length <= 2) return secret.agents.join(", ");
  return `${secret.agents.length} agents`;
}

function secretPath(name: string) {
  return `/secrets/${encodeURIComponent(name)}`;
}

/**
 * Add a secret, or replace a saved one's value. Saved values never come
 * back, so replacing starts from an empty field.
 */
function SecretDialog({
  secret,
  existing,
  onOpenChange,
  onSaved,
}: Readonly<{
  /** The secret whose value is being replaced; null when adding. */
  secret: Secret | null;
  existing: readonly Secret[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<unknown>;
}>) {
  const organizationId = useOrganizationId();
  const nameRef = useRef<ValidatedFieldHandle>(null);
  const valueRef = useRef<ValidatedFieldHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState(secret?.name ?? "");
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = secret !== null;

  async function save() {
    setError(null);
    const nameOk = editing || Boolean(nameRef.current?.commit());
    const valueOk = Boolean(valueRef.current?.commit());
    if (!nameOk || !valueOk) throw new AsyncActionAbortError();
    try {
      await orgApi(organizationId, secretPath(name.trim()), {
        method: "PUT",
        body: JSON.stringify({ value }),
      });
      await onSaved();
      window.setTimeout(() => onOpenChange(false), 400);
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not save the secret."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      description={
        editing
          ? "Saved values can't be viewed again. Enter the new value; agents that receive it get it on their next call."
          : "Once saved, the value can't be viewed again, only replaced."
      }
      onOpenChange={onOpenChange}
      open
      title={editing ? `Replace ${secret.name}` : "Add secret"}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        {editing ? null : (
          <ValidatedField
            autoFocus
            hint="Capital letters, numbers, and underscores."
            id="secret-name"
            label="Name"
            onChange={(next) => setName(next.toUpperCase())}
            placeholder="API_TOKEN"
            ref={nameRef}
            validate={(next) =>
              validateName(next) ??
              (existing.some((item) => item.name === next.trim())
                ? `${next.trim()} already exists; replace its value instead.`
                : null)
            }
            value={name}
          />
        )}
        <ValidatedField
          autoFocus={editing}
          hint="Stored encrypted."
          id="secret-value"
          label="Value"
          onChange={setValue}
          ref={valueRef}
          type="password"
          validate={validateValue}
          value={value}
        />
        {error ? (
          <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
        ) : null}
        <SettingsDialogActions
          onCancel={() => onOpenChange(false)}
          pending={pending}
        >
          <LoadingButton
            onAction={save}
            onStatusChange={(status) => setPending(status === "pending")}
            pendingLabel="Saving…"
            ref={saveRef}
            successLabel="Saved"
            type="submit"
          >
            {editing ? "Replace value" : "Add secret"}
          </LoadingButton>
        </SettingsDialogActions>
      </form>
    </SettingsDialogShell>
  );
}

/** Choose which agents' code receives a secret. */
function AgentsDialog({
  secret,
  onOpenChange,
  onSaved,
}: Readonly<{
  secret: Secret;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<unknown>;
}>) {
  const organizationId = useOrganizationId();
  const agents = useQuery({
    queryKey: ["agents", organizationId],
    queryFn: () => orgApi<Agent[]>(organizationId, "/agents"),
  });
  const [chosen, setChosen] = useState<string[]>(secret.agents);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slugs = [
    ...new Set([
      ...(agents.data ?? [])
        .filter((agent) => !agent.archived)
        .map((agent) => agent.slug),
      ...secret.agents,
    ]),
  ].sort();

  async function save() {
    setError(null);
    const path = (slug: string) =>
      `${secretPath(secret.name)}/agents/${encodeURIComponent(slug)}`;
    try {
      for (const slug of chosen.filter((s) => !secret.agents.includes(s)))
        await orgApi(organizationId, path(slug), { method: "PUT" });
      for (const slug of secret.agents.filter((s) => !chosen.includes(s)))
        await orgApi(organizationId, path(slug), { method: "DELETE" });
      await onSaved();
      window.setTimeout(() => onOpenChange(false), 400);
    } catch (cause) {
      await onSaved();
      setError(actionErrorMessage(cause, "Could not change the agents."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      description="Only these agents' deployed code receives the value, on its next call. The model never sees it."
      onOpenChange={onOpenChange}
      open
      title={`Agents that receive ${secret.name}`}
    >
      <div className="flex flex-col gap-4">
        {agents.isError ? (
          <SettingsError error={agents.error} inline />
        ) : !agents.data ? (
          <SettingsSkeletonRows count={2} />
        ) : slugs.length === 0 ? (
          <SettingsPanelMessage>
            No agents yet. Deploy one, then grant it this secret.
          </SettingsPanelMessage>
        ) : (
          <CheckboxGroup
            checkedIndices={
              new Set(
                slugs.flatMap((slug, index) =>
                  chosen.includes(slug) ? [index] : [],
                ),
              )
            }
          >
            {slugs.map((slug, index) => (
              <CheckboxItem
                checked={chosen.includes(slug)}
                index={index}
                key={slug}
                label={slug}
                onToggle={() =>
                  setChosen((current) =>
                    current.includes(slug)
                      ? current.filter((value) => value !== slug)
                      : [...current, slug],
                  )
                }
              />
            ))}
          </CheckboxGroup>
        )}
        {error ? (
          <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
        ) : null}
        <SettingsDialogActions
          onCancel={() => onOpenChange(false)}
          pending={pending}
        >
          <LoadingButton
            disabled={!agents.data || slugs.length === 0}
            onAction={save}
            onStatusChange={(status) => setPending(status === "pending")}
            pendingLabel="Saving…"
            successLabel="Saved"
          >
            Save
          </LoadingButton>
        </SettingsDialogActions>
      </div>
    </SettingsDialogShell>
  );
}

/** The organization's secrets: write-only values and the agents granted each. */
export function SecretsSection() {
  const administers = useAdministers();
  if (administers === undefined) return <SettingsSkeletonRows count={3} />;
  if (!administers)
    return (
      <SettingsEmpty
        art={<NoAccessArt />}
        description="Only organization Owners and Admins can manage secrets."
        title="Admin access required"
      />
    );
  return <Secrets />;
}

function Secrets() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const queryKey = ["secrets", organizationId];
  const secrets = useQuery({
    queryKey,
    queryFn: () => orgApi<Secret[]>(organizationId, "/secrets"),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const [dialog, setDialog] = useState<
    | { mode: "add" }
    | { mode: "replace"; secret: Secret }
    | { mode: "agents"; secret: Secret }
    | null
  >(null);
  const [deleting, setDeleting] = useState<Secret | null>(null);
  const close = (open: boolean) => (open ? undefined : setDialog(null));

  return (
    <SettingsSection
      actions={
        <Button
          disabled={!secrets.data}
          leadingIcon={Plus}
          onClick={() => setDialog({ mode: "add" })}
          size="compact"
          type="button"
          variant="secondary"
        >
          Add secret
        </Button>
      }
      description="Encrypted values for agents' deployed code. Choose which agents receive each one; the model never sees them."
    >
      {secrets.isError ? (
        <SettingsError error={secrets.error} />
      ) : !secrets.data ? (
        <SettingsSkeletonRows count={3} />
      ) : secrets.data.length === 0 ? (
        <SettingsEmpty
          art={<NothingCreatedArt />}
          description="Add encrypted secrets that agents can use in tools without exposing values to the model."
          title="No secrets yet"
        />
      ) : (
        <SettingsRows>
          {secrets.data.map((secret) => (
            <SettingsRow
              description={`Updated ${formatRelative(secret.updatedAt)} · ${grantSummary(secret)}`}
              key={secret.name}
              label={
                <span
                  className="truncate text-body text-foreground"
                  style={{ fontVariationSettings: fontWeights.medium }}
                >
                  {secret.name}
                </span>
              }
              value={
                <span
                  aria-label="Value hidden"
                  className="min-w-0 truncate text-body text-muted-foreground"
                >
                  {MASK}
                </span>
              }
            >
              {secret.live > 0 ? (
                <Badge color="green" size="sm">
                  {secret.live === 1 ? "1 live" : `${secret.live} live`}
                </Badge>
              ) : null}
              <SettingsRowMenu
                actions={[
                  {
                    label: "Replace value",
                    icon: Pencil,
                    onSelect: () => setDialog({ mode: "replace", secret }),
                  },
                  {
                    label: "Choose agents",
                    icon: Users,
                    onSelect: () => setDialog({ mode: "agents", secret }),
                  },
                  {
                    label: "Delete",
                    icon: X,
                    onSelect: () => setDeleting(secret),
                  },
                ]}
                label={`Actions for ${secret.name}`}
              />
            </SettingsRow>
          ))}
        </SettingsRows>
      )}
      {dialog?.mode === "agents" ? (
        <AgentsDialog
          key={dialog.secret.name}
          onOpenChange={close}
          onSaved={refresh}
          secret={dialog.secret}
        />
      ) : dialog ? (
        <SecretDialog
          existing={secrets.data ?? []}
          key={dialog.mode === "replace" ? dialog.secret.name : "add"}
          onOpenChange={close}
          onSaved={refresh}
          secret={dialog.mode === "replace" ? dialog.secret : null}
        />
      ) : null}
      <SettingsConfirmDialog
        confirmLabel="Delete"
        description={
          deleting
            ? "It can't be deleted while a live deployment's code uses it."
            : undefined
        }
        onConfirm={async () => {
          if (!deleting) return;
          await orgApi(organizationId, secretPath(deleting.name), {
            method: "DELETE",
          });
          await refresh();
        }}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        open={deleting !== null}
        pendingLabel="Deleting…"
        successLabel="Deleted"
        title={deleting ? `Delete ${deleting.name}?` : "Delete"}
      />
    </SettingsSection>
  );
}
