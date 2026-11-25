"use client";

import { Button } from "@preprocess/ui/components/button";
import { InputCopy } from "@preprocess/ui/components/input-copy";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { useRef, useState, type FormEvent } from "react";

import { validateOrganizationName } from "../../server/organization-name";
import { useAuth } from "../auth/auth-context";
import {
  useOrganizations,
  useRenameOrganization,
} from "../organizations/organizations-context";
import {
  deleteOrganization,
  updateOrganization,
} from "../organizations/user-organizations";
import {
  type SettingsAttemptError,
  SettingsError,
  SettingsFileDrop,
  SettingsIconTile,
  SettingsRow,
  SettingsRows,
  SettingsRowSkeleton,
  SkeletonTile,
} from "./kit";
import {
  SettingsConfirmBody,
  SettingsDialog,
  SettingsDialogActions,
  SettingsPanelMessage,
  actionErrorMessage,
} from "./kit";
import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";

function validateOrgName(value: string) {
  const result = validateOrganizationName(value);
  return result.ok ? null : result.error;
}

function EditOrganizationNameDialog({
  close,
  name: initialName,
  onSaved,
}: {
  close: () => void;
  name: string;
  onSaved: (name: string) => void;
}) {
  const { organizationId } = useAuth();
  const nameRef = useRef<ValidatedFieldHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    if (!nameRef.current?.commit()) {
      throw new AsyncActionAbortError();
    }

    try {
      if (!organizationId) throw new Error("No active organization.");
      const result = await updateOrganization(organizationId, name);
      onSaved(result.name);
      close();
    } catch (cause) {
      setError(
        actionErrorMessage(cause, "Could not update the organization name."),
      );
      throw cause;
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        saveRef.current?.run();
      }}
    >
      <ValidatedField
        ref={nameRef}
        autoComplete="organization"
        hint="Shown to everyone in this organization."
        id="organization-name"
        label="Name"
        onChange={setName}
        validate={validateOrgName}
        value={name}
      />
      {error ? (
        <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
      ) : null}
      <SettingsDialogActions onCancel={close} pending={pending}>
        <LoadingButton
          ref={saveRef}
          onAction={onSave}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Saving…"
          successLabel="Saved"
          type="submit"
        >
          Save
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}

// The root loader has the person's organizations, so settings render their
// real content on first paint.
function useCurrentOrganization() {
  const organizations = useOrganizations();
  const { organizationId } = useAuth();
  const renameOrganization = useRenameOrganization();
  const current =
    organizations.find((organization) => organization.id === organizationId) ??
    null;
  return { current, loading: false, organizations, renameOrganization };
}

function organizationInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const second = parts[1];
  if (first && second) {
    return `${first[0]}${second[0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function OrganizationMark({ name }: { name: string }) {
  return (
    <SettingsIconTile>
      <span
        className="text-micro text-foreground"
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {organizationInitials(name)}
      </span>
    </SettingsIconTile>
  );
}

function OrganizationNameEdit({
  name,
  onSaved,
}: {
  name: string;
  onSaved: (name: string) => void;
}) {
  return (
    <SettingsDialog
      description="Shown to everyone in this organization."
      title="Edit organization name"
      content={(close) => (
        <EditOrganizationNameDialog
          close={close}
          name={name}
          onSaved={onSaved}
        />
      )}
    >
      <Button
        aria-label="Edit organization name"
        type="button"
        variant="secondary"
      >
        Edit
      </Button>
    </SettingsDialog>
  );
}

type OrganizationLogoMode = "light" | "dark";

const LOGO_TYPES = [
  "image/png",
  "image/svg+xml",
  "image/jpeg",
  "image/webp",
] as const;

function logoCopy(mode: OrganizationLogoMode) {
  switch (mode) {
    case "light":
      return {
        title: "Upload light mode logo",
        label: "Light mode logo",
        hint: "Shown on light backgrounds.",
        inputId: "organization-logo-light",
      };
    case "dark":
      return {
        title: "Upload dark mode logo",
        label: "Dark mode logo",
        hint: "Shown on dark backgrounds.",
        inputId: "organization-logo-dark",
      };
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

function EditOrganizationLogoDialog({
  close,
  mode,
}: {
  close: () => void;
  mode: OrganizationLogoMode;
}) {
  const copy = logoCopy(mode);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SettingsAttemptError | null>(null);

  function onSave() {
    setError(null);
    if (!file) {
      setError({ message: "Choose a logo file.", at: Date.now() });
      throw new AsyncActionAbortError();
    }

    // TODO: persist organization logos once storage exists.
    setError({
      message: "Logo storage is not available yet.",
      at: Date.now(),
    });
    throw new AsyncActionAbortError();
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        saveRef.current?.run();
      }}
    >
      <SettingsFileDrop
        accept={LOGO_TYPES}
        error={error}
        file={file}
        hint="PNG, SVG, JPG, or WebP"
        label={copy.label}
        onFileChange={(next) => {
          setFile(next);
          setError(null);
        }}
      />
      <SettingsDialogActions onCancel={close} pending={pending}>
        <LoadingButton
          ref={saveRef}
          onAction={onSave}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Uploading…"
          successLabel="Uploaded"
          type="submit"
        >
          Upload
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}

function OrganizationLogoEdit({ mode }: { mode: OrganizationLogoMode }) {
  const copy = logoCopy(mode);
  return (
    <SettingsDialog
      description={copy.hint}
      title={copy.title}
      content={(close) => (
        <EditOrganizationLogoDialog close={close} mode={mode} />
      )}
    >
      <Button aria-label={copy.title} type="button" variant="secondary">
        Upload
      </Button>
    </SettingsDialog>
  );
}

export function OrganizationPanel() {
  const { current, loading, renameOrganization } = useCurrentOrganization();

  if (loading) {
    return (
      <SettingsRows>
        <SettingsRowSkeleton action={56} label="Name" value={120} />
        <SettingsRowSkeleton
          action={72}
          description="Shown on light backgrounds."
          label="Light mode logo"
          value={<SkeletonTile />}
        />
        <SettingsRowSkeleton
          action={72}
          description="Shown on dark backgrounds."
          label="Dark mode logo"
          value={<SkeletonTile />}
        />
      </SettingsRows>
    );
  }

  if (!current) {
    return (
      <SettingsError error={new Error("Could not load this organization.")} />
    );
  }

  return (
    <SettingsRows>
      <SettingsRow label="Name" value={current.name}>
        <OrganizationNameEdit
          name={current.name}
          onSaved={(name) => renameOrganization(current.id, name)}
        />
      </SettingsRow>
      <SettingsRow
        description="Shown on light backgrounds."
        label="Light mode logo"
        value={<OrganizationMark name={current.name} />}
      >
        <OrganizationLogoEdit mode="light" />
      </SettingsRow>
      <SettingsRow
        description="Shown on dark backgrounds."
        label="Dark mode logo"
        value={<OrganizationMark name={current.name} />}
      >
        <OrganizationLogoEdit mode="dark" />
      </SettingsRow>
    </SettingsRows>
  );
}

export function OrganizationDetailsPanel() {
  const { current, loading } = useCurrentOrganization();

  if (loading || !current) {
    return (
      <SettingsRows>
        <SettingsRowSkeleton action={260} label="Organization ID" />
      </SettingsRows>
    );
  }

  return (
    <SettingsRows>
      <SettingsRow label="Organization ID">
        <InputCopy value={current.id} />
      </SettingsRow>
    </SettingsRows>
  );
}

export function DeleteOrganizationPanel() {
  const { current, loading, organizations } = useCurrentOrganization();
  const { switchToOrganization } = useAuth();

  if (loading || !current) {
    return (
      <SettingsRows>
        <SettingsRowSkeleton
          action={64}
          description="Permanently remove this organization and all of its data."
          label="Delete organization"
        />
      </SettingsRows>
    );
  }

  async function onDelete() {
    if (!current) return;
    await deleteOrganization(current.id);
    const next = organizations.find(
      (organization) => organization.id !== current.id,
    );
    if (next) {
      await switchToOrganization(next.id);
      window.location.assign("/");
      return;
    }
    window.location.assign("/onboarding");
  }

  return (
    <SettingsRows>
      <SettingsRow
        description="Permanently remove this organization and all of its data."
        label="Delete organization"
      >
        <SettingsDialog
          description="This permanently deletes the organization and cannot be undone."
          title="Delete organization"
          content={(close) => (
            <SettingsConfirmBody
              actionLabel="Delete"
              onCancel={close}
              onConfirm={onDelete}
              pendingLabel="Deleting…"
              successLabel="Deleted"
            />
          )}
        >
          <Button type="button" variant="secondary">
            Delete
          </Button>
        </SettingsDialog>
      </SettingsRow>
    </SettingsRows>
  );
}
