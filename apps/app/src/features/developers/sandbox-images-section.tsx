import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { Check, Plus, X } from "@preprocess/ui/lib/icons";
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
import type { SandboxImage } from "./platform-store";
import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";

const REPOSITORY =
  /^[a-z0-9]+([._-][a-z0-9]+)*(\.[a-z0-9-]+)*(:\d+)?(\/[a-z0-9]+([._-][a-z0-9]+)*)+$/;
const TAG = /^[\w][\w.-]{0,127}$/;

function validateRepository(value: string) {
  const repository = value.trim();
  if (!repository) return "Enter an image, like ghcr.io/acme/sandbox.";
  if (repository.includes(":") && !/:\d+\//.test(repository)) {
    return "Put the tag in its own field.";
  }
  return REPOSITORY.test(repository)
    ? null
    : "Use a registry path, like ghcr.io/acme/sandbox.";
}

function validateTag(value: string) {
  const tag = value.trim();
  if (!tag) return "Enter a tag, like 2026.08 or latest.";
  return TAG.test(tag)
    ? null
    : "Use letters, numbers, dots, dashes, and underscores.";
}

export function imageLabel(image: SandboxImage) {
  return `${image.repository}:${image.tag}`;
}

function formatSize(sizeMb: number) {
  return sizeMb >= 1024 ? `${(sizeMb / 1024).toFixed(1)} GB` : `${sizeMb} MB`;
}

function AddImageDialog({
  open,
  onOpenChange,
  onAdd,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (repository: string, tag: string) => Promise<unknown>;
}>) {
  const repositoryRef = useRef<ValidatedFieldHandle>(null);
  const tagRef = useRef<ValidatedFieldHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [repository, setRepository] = useState("");
  const [tag, setTag] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const ok = [repositoryRef.current?.commit(), tagRef.current?.commit()];
    if (!ok.every(Boolean)) throw new AsyncActionAbortError();
    try {
      await onAdd(repository.trim(), tag.trim());
      window.setTimeout(() => onOpenChange(false), 400);
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not add the image."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      description="Agent sandboxes start from this image. Pull access comes from the registry credentials in Secrets."
      onOpenChange={onOpenChange}
      open={open}
      title="Add sandbox image"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        <ValidatedField
          autoFocus
          hint="The registry path, without the tag."
          id="image-repository"
          label="Image"
          onChange={setRepository}
          placeholder="ghcr.io/acme/sandbox"
          ref={repositoryRef}
          validate={validateRepository}
          value={repository}
        />
        <ValidatedField
          hint="Pin a version rather than latest, so runs stay repeatable."
          id="image-tag"
          label="Tag"
          onChange={setTag}
          placeholder="2026.08"
          ref={tagRef}
          validate={validateTag}
          value={tag}
        />
        {error ? (
          <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
        ) : null}
        <SettingsDialogActions
          onCancel={() => onOpenChange(false)}
          pending={pending}
        >
          <LoadingButton
            onAction={add}
            onStatusChange={(status) => setPending(status === "pending")}
            pendingLabel="Adding…"
            ref={saveRef}
            successLabel="Added"
            type="submit"
          >
            Add image
          </LoadingButton>
        </SettingsDialogActions>
      </form>
    </SettingsDialogShell>
  );
}

/**
 * The Docker images agent sandboxes run in. One is the default; agents use
 * it unless they pick another in their settings.
 */
export function SandboxImagesSection({
  images,
  defaultImageId,
  usage,
  onAdd,
  onRemove,
  onSetDefault,
}: Readonly<{
  images: readonly SandboxImage[];
  defaultImageId: string;
  /** Agents per image id; the default's count includes agents on the default. */
  usage: ReadonlyMap<string, number>;
  onAdd: (repository: string, tag: string) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  onSetDefault: (id: string) => Promise<unknown>;
}>) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SandboxImage | null>(null);

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
          Add image
        </Button>
      }
      description="Images agent sandboxes start from. Agents use the default unless their settings pick another."
    >
      {images.length === 0 ? (
        <SettingsEmpty
          art={<NothingCreatedArt />}
          description="Deploy an agent with a sandbox setup to build a reusable environment here."
          title="No custom sandbox environments"
        />
      ) : (
        <SettingsRows>
          {images.map((image) => {
            const isDefault = image.id === defaultImageId;
            const agents = usage.get(image.id) ?? 0;
            return (
              <SettingsRow
                description={`${image.digest} · ${formatSize(image.sizeMb)} · ${agents} ${agents === 1 ? "agent" : "agents"} · added ${formatRelative(image.addedAt)}`}
                key={image.id}
                label={
                  <span
                    className="truncate text-body text-foreground"
                    style={{ fontVariationSettings: fontWeights.semibold }}
                  >
                    {imageLabel(image)}
                  </span>
                }
              >
                {isDefault ? (
                  <Badge color="blue" size="sm">
                    Default
                  </Badge>
                ) : null}
                <SettingsRowMenu
                  actions={[
                    {
                      label: "Make default",
                      icon: Check,
                      disabled: isDefault,
                      onSelect: () => void onSetDefault(image.id),
                    },
                    {
                      label: "Remove",
                      icon: X,
                      disabled: isDefault,
                      onSelect: () => setRemoving(image),
                    },
                  ]}
                  label={`Actions for ${imageLabel(image)}`}
                />
              </SettingsRow>
            );
          })}
        </SettingsRows>
      )}
      {adding ? (
        <AddImageDialog onAdd={onAdd} onOpenChange={setAdding} open />
      ) : null}
      <SettingsConfirmDialog
        confirmLabel="Remove"
        description={
          removing && (usage.get(removing.id) ?? 0) > 0
            ? "Agents using it move to the default image on their next run."
            : "No agent uses this image."
        }
        onConfirm={() => (removing ? onRemove(removing.id) : Promise.resolve())}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        open={removing !== null}
        pendingLabel="Removing…"
        successLabel="Removed"
        title={removing ? `Remove ${imageLabel(removing)}?` : "Remove"}
      />
    </SettingsSection>
  );
}
