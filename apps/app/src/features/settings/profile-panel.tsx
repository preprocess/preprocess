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

export function ProfilePanel() {
  const { user } = useAuth();
  if (!user) return null;

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
