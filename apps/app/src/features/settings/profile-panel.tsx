"use client";

import { Button } from "@preprocess/ui/components/button";
import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";

import {
  useWorkOsQuery,
  useWorkOsSdk,
  workOsKey,
  type Sdk,
} from "../workos-client-api/sdk";
import { expectResultMember } from "../workos-client-api/vendor/client-graphql-result";
import type { MeQuery } from "../workos-client-api/vendor/generated";
import {
  SettingsAvatar,
  SettingsError,
  SettingsRow,
  SettingsRows,
  SettingsRowSkeleton,
  SkeletonCircle,
  SettingsReveal,
} from "./kit";
import {
  ElevatedVerifyStep,
  VerificationSettingsDialog,
  validateEmail,
  validateRequired,
} from "./settings-elevated";
import { displayName } from "./settings-format";
import { OAuthMark, oauthAccounts, oauthLabel } from "./settings-oauth";
import {
  SettingsDialog,
  SettingsDialogActions,
  SettingsPanelMessage,
  actionErrorMessage,
} from "./kit";

type MeProfile = MeQuery["me"];

function optionalName(value: string) {
  return value.trim().length > 80 ? "Keep this under 80 characters." : null;
}

function nameValue(profile: MeProfile) {
  return (
    displayName(profile) || (
      <span className="text-muted-foreground">Not set</span>
    )
  );
}

type EmailStep =
  | { kind: "verify" }
  | { kind: "new-email"; token: string }
  | { kind: "confirm"; token: string }
  | { kind: "set-password"; token: string; email: string };

function EditNameDialog({
  close,
  firstName: initialFirstName,
  sdk,
  lastName: initialLastName,
  onSaved,
}: {
  close: () => void;
  firstName: string;
  sdk: Sdk;
  lastName: string;
  onSaved: (names: {
    firstName: string | null;
    lastName: string | null;
  }) => void;
}) {
  const firstNameRef = useRef<InlineValidationHandle>(null);
  const lastNameRef = useRef<InlineValidationHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    if (!firstNameRef.current?.commit() || !lastNameRef.current?.commit()) {
      throw new AsyncActionAbortError();
    }

    try {
      const data = await sdk.UpdateProfile({
        input: { firstName: firstName.trim(), lastName: lastName.trim() },
      });
      expectResultMember(data.updateProfile, "ProfileUpdated");
      onSaved({
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
      });
      close();
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not update your profile."));
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
        ref={firstNameRef}
        autoComplete="given-name"
        hint="Shown on your account."
        id="profile-first-name"
        label="First name"
        name="firstName"
        onChange={setFirstName}
        validate={optionalName}
        value={firstName}
      />
      <InlineValidation
        ref={lastNameRef}
        autoComplete="family-name"
        hint="Shown on your account."
        id="profile-last-name"
        label="Last name"
        name="lastName"
        onChange={setLastName}
        validate={optionalName}
        value={lastName}
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

function SetPasswordAfterEmailForm({
  close,
  email,
  sdk,
  onCreated,
  token,
}: {
  close: () => void;
  email: string;
  sdk: Sdk;
  onCreated: () => void;
  token: string;
}) {
  const passwordRef = useRef<InlineValidationHandle>(null);
  const confirmRef = useRef<InlineValidationHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        saveRef.current?.run();
      }}
    >
      <SettingsPanelMessage>
        Your email has been successfully updated to {email}. You can also set a
        password now.
      </SettingsPanelMessage>
      <InlineValidation
        ref={passwordRef}
        autoComplete="new-password"
        hint="Must be at least 8 characters."
        id="email-change-password"
        label="Password"
        name="password"
        onChange={setPassword}
        type="password"
        validate={validateRequired("Enter a password.")}
        value={password}
      />
      <InlineValidation
        ref={confirmRef}
        autoComplete="new-password"
        id="email-change-password-confirm"
        label="Confirm password"
        name="confirmPassword"
        onChange={setConfirm}
        type="password"
        validate={(value) =>
          value === password ? null : "Passwords must match."
        }
        value={confirm}
      />
      {error ? (
        <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
      ) : null}
      <SettingsDialogActions
        cancelLabel="Not now"
        onCancel={close}
        pending={pending}
      >
        <LoadingButton
          ref={saveRef}
          onAction={async () => {
            if (
              !passwordRef.current?.commit() ||
              !confirmRef.current?.commit()
            ) {
              throw new AsyncActionAbortError();
            }
            setError(null);
            try {
              const data = await sdk.CreatePassword({
                input: { password, elevatedAccessToken: token },
              });
              expectResultMember(data.createPassword, "PasswordCreated");
              onCreated();
            } catch (cause) {
              setError(
                actionErrorMessage(cause, "Could not create a password."),
              );
              throw cause;
            }
          }}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Creating…"
          successLabel="Created"
          type="submit"
        >
          Set a password
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}

function ChangeEmailDialog({
  close,
  currentEmail,
  sdk,
  onChanged,
  passwordSet,
}: {
  close: () => void;
  currentEmail: string;
  sdk: Sdk;
  onChanged: (email: string, passwordSet?: boolean) => void;
  passwordSet: boolean;
}) {
  const emailRef = useRef<InlineValidationHandle>(null);
  const sendRef = useRef<LoadingButtonHandle>(null);
  const [step, setStep] = useState<EmailStep>({ kind: "verify" });
  const [nextEmail, setNextEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<InlineValidationHandle>(null);
  const confirmRef = useRef<LoadingButtonHandle>(null);

  async function onSendEmailChange() {
    if (step.kind !== "new-email") {
      throw new AsyncActionAbortError();
    }
    if (!emailRef.current?.commit()) {
      throw new AsyncActionAbortError();
    }
    setError(null);
    try {
      const data = await sdk.SendEmailChange({
        input: { elevatedAccessToken: step.token, newEmail: nextEmail.trim() },
      });
      expectResultMember(data.sendEmailChange, "EmailChangeSent");
      setCode("");
      setStep({ kind: "confirm", token: step.token });
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not send that code."));
      throw cause;
    }
  }

  async function onConfirmEmailChange() {
    if (step.kind !== "confirm") {
      throw new AsyncActionAbortError();
    }
    if (!codeRef.current?.commit()) {
      throw new AsyncActionAbortError();
    }
    setError(null);
    try {
      const data = await sdk.ConfirmEmailChange({
        input: { code: code.trim(), elevatedAccessToken: step.token },
      });
      const confirmed = expectResultMember(
        data.confirmEmailChange,
        "EmailChangeConfirmed",
      );
      const email = nextEmail.trim();
      onChanged(email);
      const nextToken = confirmed.elevatedAccessToken;
      if (!passwordSet) {
        setStep({ kind: "set-password", token: nextToken, email });
        return;
      }
      close();
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not confirm that email."));
      throw cause;
    }
  }

  switch (step.kind) {
    case "verify":
      return (
        <ElevatedVerifyStep
          email={currentEmail}
          onCancel={close}
          onVerified={(token) => {
            setStep({ kind: "new-email", token });
          }}
        />
      );
    case "new-email":
      return (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            sendRef.current?.run();
          }}
        >
          <InlineValidation
            ref={emailRef}
            autoComplete="email"
            hint="We will send a code to this address."
            id="next-email"
            label="New email"
            name="email"
            onChange={setNextEmail}
            type="email"
            validate={validateEmail}
            value={nextEmail}
          />
          {error ? (
            <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
          ) : null}
          <SettingsDialogActions onCancel={close} pending={pending}>
            <LoadingButton
              ref={sendRef}
              onAction={onSendEmailChange}
              onStatusChange={(status) => setPending(status === "pending")}
              pendingLabel="Sending…"
              successLabel="Sent"
              type="submit"
            >
              Send code
            </LoadingButton>
          </SettingsDialogActions>
        </form>
      );
    case "set-password":
      return (
        <SetPasswordAfterEmailForm
          close={close}
          email={step.email}
          sdk={sdk}
          onCreated={() => {
            onChanged(step.email, true);
            close();
          }}
          token={step.token}
        />
      );
    case "confirm":
      return (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            confirmRef.current?.run();
          }}
        >
          <InlineValidation
            ref={codeRef}
            autoComplete="one-time-code"
            hint={`Enter the code we sent to ${nextEmail.trim()}.`}
            id="email-change-code"
            inputMode="numeric"
            label="Verification code"
            name="code"
            onChange={setCode}
            validate={(value) => (value.trim() ? null : "Enter the code.")}
            value={code}
          />
          {error ? (
            <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
          ) : null}
          <SettingsDialogActions onCancel={close} pending={pending}>
            <LoadingButton
              ref={confirmRef}
              onAction={onConfirmEmailChange}
              onStatusChange={(status) => setPending(status === "pending")}
              pendingLabel="Checking…"
              successLabel="Confirmed"
              type="submit"
            >
              Confirm email
            </LoadingButton>
          </SettingsDialogActions>
        </form>
      );
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

function ProfileSkeleton() {
  return (
    <SettingsRows>
      <SettingsRowSkeleton label="Profile picture" value={<SkeletonCircle />} />
      <SettingsRowSkeleton action={56} label="Full name" value={120} />
      <SettingsRowSkeleton action={56} label="Email address" value={180} />
    </SettingsRows>
  );
}

export function ProfilePanel() {
  const sdk = useWorkOsSdk();
  const queryClient = useQueryClient();
  const meQuery = useWorkOsQuery({
    queryKey: workOsKey("Me"),
    queryFn: (client) => client.Me(),
  });

  if (meQuery.isError) return <SettingsError error={meQuery.error} />;

  return (
    <SettingsReveal data={meQuery.data} skeleton={<ProfileSkeleton />}>
      {(data) => {
        const profile = data.me;
        const accounts = oauthAccounts(profile.connectedAccounts);
        const updateProfile = (patch: Partial<MeProfile>) => {
          queryClient.setQueryData<MeQuery>(workOsKey("Me"), (current) =>
            current ? { ...current, me: { ...current.me, ...patch } } : current,
          );
        };

        return (
          <SettingsRows>
            {profile.profilePictureUrl ? (
              <SettingsRow
                label="Profile picture"
                value={
                  <SettingsAvatar
                    name={displayName(profile) || profile.email}
                    pictureUrl={profile.profilePictureUrl}
                  />
                }
              />
            ) : null}
            <SettingsRow label="Full name" value={nameValue(profile)}>
              <SettingsDialog
                description="Shown on your account."
                title="Edit name"
                content={(close) => (
                  <EditNameDialog
                    close={close}
                    firstName={profile.firstName ?? ""}
                    lastName={profile.lastName ?? ""}
                    onSaved={updateProfile}
                    sdk={sdk}
                  />
                )}
              >
                <Button
                  aria-label="Edit name"
                  type="button"
                  variant="secondary"
                >
                  Edit
                </Button>
              </SettingsDialog>
            </SettingsRow>
            <SettingsRow label="Email address" value={profile.email}>
              <VerificationSettingsDialog
                description="Confirm it is you, then enter the new address."
                title="Change email"
                trigger={
                  <Button
                    aria-label="Edit email"
                    type="button"
                    variant="secondary"
                  >
                    Edit
                  </Button>
                }
              >
                {({ close }) => (
                  <ChangeEmailDialog
                    close={close}
                    currentEmail={profile.email}
                    onChanged={(email, nextPasswordSet) => {
                      updateProfile({
                        email,
                        passwordSet: nextPasswordSet ?? profile.passwordSet,
                      });
                    }}
                    passwordSet={profile.passwordSet}
                    sdk={sdk}
                  />
                )}
              </VerificationSettingsDialog>
            </SettingsRow>
            {accounts.length > 0 ? (
              <SettingsRow
                label="Connected accounts"
                value={
                  <span className="flex flex-col gap-1">
                    {accounts.map((account) => (
                      <span
                        className="flex items-center gap-2"
                        key={account.provider}
                      >
                        <OAuthMark provider={account.provider} />
                        <span className="text-foreground">
                          {oauthLabel(account.provider)}
                        </span>
                        {account.email ? (
                          <span className="hidden sm:inline">
                            · {account.email}
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </span>
                }
              />
            ) : null}
          </SettingsRows>
        );
      }}
    </SettingsReveal>
  );
}
