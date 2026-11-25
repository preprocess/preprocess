"use client";

import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { Button } from "@preprocess/ui/components/button";
import { Switch } from "@preprocess/ui/components/switch";
import { useRef, useState, type FormEvent } from "react";

import { useAuth } from "../auth/auth-context";
import { authPost } from "../auth/client";
import {
  SettingsDialog,
  SettingsDialogActions,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRows,
  actionErrorMessage,
} from "./kit";

function validateName(value: string) {
  return value.trim() ? null : "Enter your name.";
}

function EditNameDialog({
  close,
  name: initialName,
}: {
  close: () => void;
  name: string;
}) {
  const nameRef = useRef<InlineValidationHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    if (!nameRef.current?.commit()) throw new AsyncActionAbortError();
    try {
      await authPost("/update-user", { name: name.trim() });
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not change your name."));
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
        autoComplete="name"
        hint="Shown to people in your organizations."
        id="profile-name"
        label="Name"
        onChange={setName}
        validate={validateName}
        value={name}
      />
      {error ? (
        <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
      ) : null}
      <SettingsDialogActions onCancel={close} pending={pending}>
        <LoadingButton
          ref={saveRef}
          onAction={onSave}
          onStatusChange={(status) => {
            setPending(status === "pending");
            // The session loads with the page, so reload to show the name.
            if (status === "success")
              window.setTimeout(() => window.location.reload(), 600);
          }}
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

function EmailNotifications({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setError(null);
    setPending(true);
    try {
      await authPost("/update-user", { emailNotifications: next });
    } catch (cause) {
      setEnabled(!next);
      setError(
        actionErrorMessage(cause, "Could not change your email setting."),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsRows>
      <div className="flex flex-col gap-2 px-5 py-3">
        <Switch
          checked={enabled}
          disabled={pending}
          label="Email notifications"
          onToggle={() => void toggle()}
        />
        <span className="text-caption text-muted-foreground">
          Email me right away when a case waits on one of my groups, one of my
          groups is mentioned, or a case is assigned to me. The inbox lists them
          either way.
        </span>
        {error ? (
          <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
        ) : null}
      </div>
    </SettingsRows>
  );
}

export function ProfilePanel() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="flex flex-col gap-6">
      <ProfileRows user={user} />
      <EmailNotifications initial={user.emailNotifications} />
    </div>
  );
}

function ProfileRows({ user }: { user: { name: string; email: string } }) {
  return (
    <SettingsRows>
      <SettingsRow label="Name" value={user.name}>
        <SettingsDialog
          content={(close) => <EditNameDialog close={close} name={user.name} />}
          title="Change your name"
        >
          <Button type="button" variant="secondary">
            Edit
          </Button>
        </SettingsDialog>
      </SettingsRow>
      <SettingsRow label="Email" value={user.email} />
    </SettingsRows>
  );
}
