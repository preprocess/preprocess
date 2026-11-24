"use client";

import { Button } from "@preprocess/ui/components/button";
import { InputCopy } from "@preprocess/ui/components/input-copy";
import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import { useRef, useState, type FormEvent } from "react";

import { validateOrganizationName } from "../../server/organization-name";
import {
  useOrganizations,
  useRenameOrganization,
} from "../organizations/organizations-context";
import {
  deleteUserOrganization,
  updateUserOrganization,
} from "../organizations/user-organizations";
import { useClientApiSession } from "../workos-client-api/client-api-session";
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
  const updateOrg = useServerFn(updateUserOrganization);
  const nameRef = useRef<InlineValidationHandle>(null);
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
      const result = await updateOrg({ data: { name } });
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
      <InlineValidation
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

// The root loader already has the user's organizations (server-rendered for
// the sidebar), so the General tab renders its real content on first paint;
// the client session's list takes over once it loads.
function useCurrentOrganization() {
  const {
    organizations: clientOrganizations,
    session,
    loading: clientLoading,
    updateOrganizationName,
  } = useClientApiSession();
  const serverOrganizations = useOrganizations();
  const { organizationId } = useAuth();
  const renameOrganization = useRenameOrganization();
  const organizations =
    clientOrganizations.length > 0 ? clientOrganizations : serverOrganizations;
  const current =
    organizations.find((organization) => organization.isCurrent) ??
    organizations.find(
      (organization) =>
        organization.id === (session?.organizationId ?? organizationId),
    ) ??
    null;

  return {
    current,
    loading: !current && clientLoading,
    organizations,
    renameOrganization,
    updateOrganizationName,
  };
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
  const { current, loading, renameOrganization, updateOrganizationName } =
    useCurrentOrganization();

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
          onSaved={(name) => {
            updateOrganizationName(current.id, name);
            renameOrganization(current.id, name);
          }}
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
  const deleteOrg = useServerFn(deleteUserOrganization);
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
    await deleteOrg();
    const next = organizations.find(
      (organization) => organization.id !== current.id,
    );
    if (next) {
      const switched = await switchToOrganization(next.id);
      if (!switched || !("error" in switched && switched.error)) {
        window.location.assign("/");
        return;
      }
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
