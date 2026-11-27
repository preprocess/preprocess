import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { Lock, Pencil, Plus, X } from "@preprocess/ui/lib/icons";
import { useRef, useState, type FormEvent } from "react";

import { NothingCreatedArt } from "../../components/empty-art";

import {
  SettingsConfirmDialog,
  SettingsDialogActions,
  SettingsDialogShell,
  SettingsEmpty,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRowMenu,
  SettingsRows,
  SettingsSection,
  actionErrorMessage,
  formatRelative,
} from "../settings/kit";
import {
  DEFAULT_SECRET_SCOPE,
  type SecretScope,
  type SecretSummary,
} from "./platform-store";
import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";

export type SecretItem = SecretSummary;

const SCOPES = [
  { value: "production", label: "Production" },
  { value: "preview", label: "Previews and dev" },
  { value: "all", label: "All deployments" },
] as const satisfies readonly { value: SecretScope; label: string }[];

const SCOPE_LABEL: Record<SecretScope, string> = {
  production: "Production",
  preview: "Previews",
  all: "All",
};

function scopeValue(value: string): SecretScope {
  return value === "preview" || value === "all" ? value : "production";
}

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const MASK = "••••••••";

function validateKey(value: string) {
  const key = value.trim();
  if (!key) return "Enter a name, like API_TOKEN.";
  if (!KEY_PATTERN.test(key)) {
    return "Use capital letters, numbers, and underscores, starting with a letter.";
  }
  return null;
}

function validateValue(value: string) {
  return value.length > 0 ? null : "Enter a value.";
}

/** A saved value, which is write-only: dots, no reveal or copy. */
function SecretValue() {
  return (
    <span
      aria-label="Value hidden"
      className="min-w-0 truncate text-body text-muted-foreground"
    >
      {MASK}
    </span>
  );
}

function SecretKey({ name }: Readonly<{ name: string }>) {
  return (
    <span
      className="truncate text-body text-foreground"
      style={{ fontVariationSettings: fontWeights.semibold }}
    >
      {name}
    </span>
  );
}

/**
 * Add a variable, or replace a saved one's value. Saved values never come
 * back, so replacing starts from an empty field. A key the organization
 * owns is refused.
 */
function SecretDialog({
  open,
  onOpenChange,
  item,
  noun,
  conflict,
  onSave,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The variable whose value is being replaced; absent when adding. */
  item: SecretItem | null;
  noun: string;
  /** Why a key can't be used here, or null when it can. */
  conflict: (key: string) => string | null;
  onSave: (key: string, value: string, scope: SecretScope) => Promise<unknown>;
}>) {
  const [scope, setScope] = useState<SecretScope>(
    item?.scope ?? DEFAULT_SECRET_SCOPE,
  );
  const keyRef = useRef<ValidatedFieldHandle>(null);
  const valueRef = useRef<ValidatedFieldHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [key, setKey] = useState(item?.key ?? "");
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = item !== null;

  async function save() {
    setError(null);
    const keyOk = editing || Boolean(keyRef.current?.commit());
    const valueOk = Boolean(valueRef.current?.commit());
    if (!keyOk || !valueOk) throw new AsyncActionAbortError();
    try {
      await onSave(key.trim(), value, scope);
      window.setTimeout(() => onOpenChange(false), 400);
    } catch (cause) {
      setError(actionErrorMessage(cause, `Could not save the ${noun}.`));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      onOpenChange={onOpenChange}
      open={open}
      description={
        editing
          ? "Saved values can't be viewed again. Enter the new value."
          : `Once saved, the value can't be viewed again; only replaced.`
      }
      title={editing ? `Replace ${item.key}` : `Add ${noun}`}
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
            id="secret-key"
            label="Name"
            onChange={(next) => setKey(next.toUpperCase())}
            placeholder="API_TOKEN"
            ref={keyRef}
            validate={(next) => validateKey(next) ?? conflict(next.trim())}
            value={key}
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
        <div className="flex flex-col gap-1.5">
          <span className="text-body text-foreground">Available to</span>
          <Select
            onValueChange={(next) => setScope(scopeValue(next))}
            value={scope}
          >
            <SelectTrigger aria-label="Available to" />
            <SelectContent>
              {SCOPES.map((option, index) => (
                <SelectItem
                  index={index}
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-caption text-muted-foreground">
            Previews and dev sessions use test credentials unless you include
            them.
          </span>
        </div>
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
            {editing ? "Replace value" : `Add ${noun}`}
          </LoadingButton>
        </SettingsDialogActions>
      </form>
    </SettingsDialogShell>
  );
}

/**
 * Variables as a settings section: masked values with reveal and copy,
 * edit and delete per row, and Add. `inherited` lists variables set
 * higher up (the organization's secrets on an agent): they show first,
 * locked, and their keys can't be reused here.
 */
export function SecretsSection({
  title,
  description,
  noun,
  items,
  inherited = [],
  conflict = () => null,
  onSave,
  onDelete,
}: Readonly<{
  /** Omitted when the page or tab already names the list. */
  title?: string;
  description?: string;
  /** "secret", "variable". */
  noun: string;
  items: readonly SecretItem[];
  inherited?: readonly SecretItem[];
  conflict?: (key: string) => string | null;
  onSave: (key: string, value: string, scope: SecretScope) => Promise<unknown>;
  onDelete: (key: string) => Promise<unknown>;
}>) {
  const [dialog, setDialog] = useState<
    { mode: "add" } | { mode: "edit"; item: SecretItem } | null
  >(null);
  const [deleting, setDeleting] = useState<SecretItem | null>(null);
  const inheritedKeys = new Set(inherited.map((item) => item.key));
  const keyConflict = (key: string) =>
    inheritedKeys.has(key)
      ? `${key} is set by the organization and can't be overridden here.`
      : items.some((item) => item.key === key)
        ? `${key} already exists; edit it instead.`
        : conflict(key);

  return (
    <SettingsSection
      actions={
        <Button
          leadingIcon={Plus}
          onClick={() => setDialog({ mode: "add" })}
          size="compact"
          type="button"
          variant="secondary"
        >
          Add {noun}
        </Button>
      }
      description={description}
      title={title}
    >
      {items.length + inherited.length === 0 ? (
        <SettingsEmpty
          art={<NothingCreatedArt />}
          description="Add encrypted secrets that agents can use in tools without exposing values to the model."
          title="No secrets yet"
        />
      ) : (
        <SettingsRows>
          {inherited.map((item) => (
            <SettingsRow
              description="Set by the organization · can't be overridden"
              key={`org:${item.key}`}
              label={<SecretKey name={item.key} />}
              value={<SecretValue />}
            >
              <Badge size="sm">
                <span className="flex items-center gap-1">
                  <Lock aria-hidden="true" className="size-3" />
                  Organization
                </span>
              </Badge>
            </SettingsRow>
          ))}
          {items.map((item) => (
            <SettingsRow
              description={`Updated ${formatRelative(item.updatedAt)}`}
              key={item.key}
              label={<SecretKey name={item.key} />}
              value={<SecretValue />}
            >
              <Badge color="gray" size="sm">
                {SCOPE_LABEL[item.scope]}
              </Badge>
              <SettingsRowMenu
                actions={[
                  {
                    label: "Edit",
                    icon: Pencil,
                    onSelect: () => setDialog({ mode: "edit", item }),
                  },
                  {
                    label: "Delete",
                    icon: X,
                    onSelect: () => setDeleting(item),
                  },
                ]}
                label={`Actions for ${item.key}`}
              />
            </SettingsRow>
          ))}
        </SettingsRows>
      )}
      {dialog ? (
        <SecretDialog
          conflict={keyConflict}
          item={dialog.mode === "edit" ? dialog.item : null}
          key={dialog.mode === "edit" ? dialog.item.key : "add"}
          noun={noun}
          onOpenChange={(open) => (open ? undefined : setDialog(null))}
          onSave={onSave}
          open
        />
      ) : null}
      <SettingsConfirmDialog
        confirmLabel="Delete"
        description={
          deleting
            ? `Deployed code loses ${deleting.key} on its next run.`
            : undefined
        }
        onConfirm={() =>
          deleting ? onDelete(deleting.key) : Promise.resolve()
        }
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        open={deleting !== null}
        pendingLabel="Deleting…"
        successLabel="Deleted"
        title={deleting ? `Delete ${deleting.key}?` : "Delete"}
      />
    </SettingsSection>
  );
}
