"use client";

// Port of the WorkOS UserSecurity widget (@workos-inc/widgets): password,
// authenticator app, and passkeys, each shown only when the environment's
// authentication settings allow it.

import { Button } from "@preprocess/ui/components/button";
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
import { Lock, Plus, X } from "@preprocess/ui/lib/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  useWorkOsQuery,
  useWorkOsSdk,
  workOsKey,
} from "../workos-client-api/sdk";
import {
  PasswordPolicyViolationError,
  expectResultMember,
} from "../workos-client-api/vendor/client-graphql-result";
import type {
  EnrollTotpMutation,
  PasskeysQuery,
} from "../workos-client-api/vendor/generated";
import {
  SettingsEmpty,
  SettingsError,
  SettingsIconTile,
  SettingsReveal,
  SettingsRow,
  SettingsRowMenu,
  SettingsRows,
  SettingsRowSkeleton,
  SettingsSection,
  SettingsStatus,
  SkeletonButton,
} from "./kit";
import {
  ElevatedVerifyStep,
  VerificationSettingsDialog,
  passwordPolicyHint,
  validateRequired,
} from "./settings-elevated";
import { lastUsedLabel, relativeTime } from "./settings-format";
import {
  SettingsDialog,
  SettingsDialogActions,
  SettingsPanelMessage,
  actionErrorMessage,
} from "./kit";

type TotpFactor = Extract<
  EnrollTotpMutation["enrollTotp"],
  { __typename: "TotpFactor" }
>;
type Passkey = PasskeysQuery["passkeys"][number];

/** The error after a failed save; password policy failures list each rule. */
function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  if (error instanceof PasswordPolicyViolationError) {
    return (
      <div className="flex flex-col gap-1" role="alert">
        <p className="text-body text-destructive">{error.message}</p>
        {error.violations.length > 0 ? (
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-caption text-destructive">
            {error.violations.map((violation) => (
              <li key={violation.code}>{violation.message}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  return (
    <SettingsPanelMessage tone="danger">
      {actionErrorMessage(error, "Something went wrong. Please try again.")}
    </SettingsPanelMessage>
  );
}

function validateNewPassword(value: string) {
  if (!value.trim()) return "Please enter a new password";
  if (value.length < 8) return "Password must be at least 8 characters";
  return null;
}

function ChangePasswordForm({
  close,
  policyHint,
}: {
  close: () => void;
  policyHint: string;
}) {
  const sdk = useWorkOsSdk();
  const currentRef = useRef<InlineValidationHandle>(null);
  const nextRef = useRef<InlineValidationHandle>(null);
  const confirmRef = useRef<InlineValidationHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        saveRef.current?.run();
      }}
    >
      <InlineValidation
        ref={currentRef}
        autoComplete="current-password"
        id="current-password"
        label="Current password"
        name="currentPassword"
        onChange={setCurrentPassword}
        placeholder="Enter your current password"
        type="password"
        validate={validateRequired("Please enter your current password")}
        value={currentPassword}
      />
      <InlineValidation
        ref={nextRef}
        autoComplete="new-password"
        hint={policyHint}
        id="new-password"
        label="New password"
        name="newPassword"
        onChange={setNewPassword}
        placeholder="Enter your new password"
        type="password"
        validate={(value) =>
          validateNewPassword(value) ??
          (value === currentPassword
            ? "You cannot reuse your current password"
            : null)
        }
        value={newPassword}
      />
      <InlineValidation
        ref={confirmRef}
        autoComplete="new-password"
        id="confirm-new-password"
        label="Confirm new password"
        name="confirmPassword"
        onChange={setConfirmPassword}
        placeholder="Confirm your new password"
        type="password"
        validate={(value) => {
          if (!value) return "Please confirm your new password";
          return value === newPassword
            ? null
            : "The new passwords you entered don't match.";
        }}
        value={confirmPassword}
      />
      <FormError error={error} />
      <SettingsDialogActions onCancel={close} pending={pending}>
        <LoadingButton
          ref={saveRef}
          onAction={async () => {
            if (
              !currentRef.current?.commit() ||
              !nextRef.current?.commit() ||
              !confirmRef.current?.commit()
            ) {
              throw new AsyncActionAbortError();
            }
            setError(null);
            try {
              const data = await sdk.UpdatePassword({
                input: { currentPassword, newPassword },
              });
              expectResultMember(data.updatePassword, "PasswordUpdated");
              close();
            } catch (cause) {
              setError(cause);
              throw cause;
            }
          }}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Changing…"
          successLabel="Changed"
          type="submit"
        >
          Change password
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}

function SetPasswordFlow({
  close,
  email,
  onCreated,
  policyHint,
}: {
  close: () => void;
  email: string;
  onCreated: () => Promise<unknown>;
  policyHint: string;
}) {
  const sdk = useWorkOsSdk();
  const passwordRef = useRef<InlineValidationHandle>(null);
  const confirmRef = useRef<InlineValidationHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!token) {
    return (
      <ElevatedVerifyStep
        email={email}
        onCancel={close}
        onVerified={setToken}
      />
    );
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
        ref={passwordRef}
        autoComplete="new-password"
        hint={policyHint}
        id="create-password"
        label="Password"
        name="password"
        onChange={setPassword}
        placeholder="Enter a password"
        type="password"
        validate={validateNewPassword}
        value={password}
      />
      <InlineValidation
        ref={confirmRef}
        autoComplete="new-password"
        id="create-password-confirm"
        label="Confirm password"
        name="confirmPassword"
        onChange={setConfirm}
        placeholder="Confirm your password"
        type="password"
        validate={(value) => {
          if (!value) return "Please confirm your new password";
          return value === password
            ? null
            : "The passwords you entered don't match.";
        }}
        value={confirm}
      />
      <FormError error={error} />
      <SettingsDialogActions onCancel={close} pending={pending}>
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
              await onCreated();
              close();
            } catch (cause) {
              setError(cause);
              throw cause;
            }
          }}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Setting…"
          successLabel="Set"
          type="submit"
        >
          Set password
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}

function AddAuthenticatorFlow({
  close,
  email,
  onEnrolled,
}: {
  close: () => void;
  email: string;
  onEnrolled: () => Promise<unknown>;
}) {
  const sdk = useWorkOsSdk();
  const codeRef = useRef<InlineValidationHandle>(null);
  const verifyRef = useRef<LoadingButtonHandle>(null);
  const [enrollment, setEnrollment] = useState<{
    token: string;
    factor: TotpFactor;
  } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!enrollment) {
    return (
      <ElevatedVerifyStep
        email={email}
        onCancel={close}
        onVerified={async (token) => {
          const data = await sdk.EnrollTotp({
            input: { elevatedAccessToken: token },
          });
          const factor = expectResultMember(data.enrollTotp, "TotpFactor");
          setEnrollment({ token, factor });
        }}
      />
    );
  }

  const { factor, token } = enrollment;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        verifyRef.current?.run();
      }}
    >
      <Step number={1} title="Scan the QR code">
        <p className="text-body text-muted-foreground">
          Use an authenticator app like 1Password, Google Authenticator, Authy,
          or Microsoft Authenticator to scan the QR code below.
        </p>
        {factor.qrCode ? (
          <img
            alt="Scan this QR code to enroll"
            className="size-40 self-start rounded-lg bg-white p-2"
            src={factor.qrCode}
          />
        ) : null}
        {showKey ? (
          <InputCopy label="Your setup key" value={factor.secret} />
        ) : (
          <p className="text-caption text-muted-foreground">
            Can’t scan the code?{" "}
            <button
              className="text-foreground underline underline-offset-2"
              onClick={() => setShowKey(true)}
              type="button"
            >
              View setup key
            </button>
          </p>
        )}
      </Step>
      <Step number={2} title="Get verification passcode">
        <InlineValidation
          ref={codeRef}
          autoComplete="one-time-code"
          hint="Enter the 6-digit passcode from your authenticator app."
          id="totp-code"
          inputMode="numeric"
          label="Passcode"
          name="code"
          onChange={setCode}
          validate={validateRequired("Enter the passcode.")}
          value={code}
        />
      </Step>
      <FormError error={error} />
      <SettingsDialogActions onCancel={close} pending={pending}>
        <LoadingButton
          ref={verifyRef}
          onAction={async () => {
            if (!codeRef.current?.commit()) throw new AsyncActionAbortError();
            setError(null);
            try {
              const data = await sdk.VerifyTotp({
                input: {
                  authenticationChallengeId: factor.authenticationChallengeId,
                  code: code.trim(),
                  elevatedAccessToken: token,
                },
              });
              expectResultMember(data.verifyTotp, "TotpVerified");
              await onEnrolled();
              close();
            } catch (cause) {
              setError(cause);
              throw cause;
            }
          }}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Checking…"
          successLabel="Confirmed"
          type="submit"
        >
          Confirm
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <p className="text-caption text-muted-foreground">
        Step {number} · <span className="text-foreground">{title}</span>
      </p>
      {children}
    </section>
  );
}

export function disableMfaCopy(passwordSet: boolean) {
  return passwordSet
    ? "We will only ask for your password during sign-in."
    : "We will not ask for additional verification during sign-in.";
}

function RemoveAuthenticatorFlow({
  close,
  email,
  onRemoved,
}: {
  close: () => void;
  email: string;
  onRemoved: () => Promise<unknown>;
}) {
  const sdk = useWorkOsSdk();
  return (
    <ElevatedVerifyStep
      email={email}
      onCancel={close}
      onVerified={async (token) => {
        const data = await sdk.RemoveMfaFactor({
          input: { elevatedAccessToken: token },
        });
        expectResultMember(data.removeMfaFactor, "MfaFactorRemoved");
        await onRemoved();
        close();
      }}
    />
  );
}

// WebAuthn options and credentials cross the API as JSON; the browser's
// JSON helpers convert them (Chrome 129+, Safari 18+, Firefox 119+).
function passkeysSupported() {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential?.parseCreationOptionsFromJSON ===
      "function"
  );
}

async function createPasskeyCredential(options: unknown): Promise<unknown> {
  const json = (
    options && typeof options === "object" && "publicKey" in options
      ? options.publicKey
      : options
  ) as PublicKeyCredentialCreationOptionsJSON;
  const credential = await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(json),
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("Passkey creation was cancelled.");
  }
  return credential.toJSON() as unknown;
}

function AddPasskeyFlow({
  close,
  email,
  onAdded,
}: {
  close: () => void;
  email: string;
  onAdded: () => Promise<unknown>;
}) {
  const sdk = useWorkOsSdk();
  return (
    <ElevatedVerifyStep
      email={email}
      onCancel={close}
      onVerified={async (token) => {
        const registration = await sdk.RegisterPasskey({
          input: { elevatedAccessToken: token },
        });
        const options = expectResultMember(
          registration.registerPasskey,
          "PasskeyRegistrationOptions",
        );
        const response = await createPasskeyCredential(options.options);
        const data = await sdk.VerifyPasskey({
          input: {
            challengeId: options.challengeId,
            elevatedAccessToken: token,
            response,
          },
        });
        expectResultMember(data.verifyPasskey, "PasskeyVerified");
        await onAdded();
        close();
      }}
    />
  );
}

function RemovePasskeyFlow({
  close,
  email,
  passkey,
  onRemoved,
}: {
  close: () => void;
  email: string;
  passkey: Passkey;
  onRemoved: () => Promise<unknown>;
}) {
  const sdk = useWorkOsSdk();
  return (
    <ElevatedVerifyStep
      email={email}
      onCancel={close}
      onVerified={async (token) => {
        const data = await sdk.DeletePasskey({
          input: { elevatedAccessToken: token, passkeyId: passkey.id },
        });
        expectResultMember(data.deletePasskey, "PasskeyDeleted");
        await onRemoved();
        close();
      }}
    />
  );
}

function passkeyDetail(passkey: Passkey) {
  const added = relativeTime(passkey.createdAt);
  const lastUsed = relativeTime(passkey.lastVerifiedAt);
  return [
    added ? `Added ${added}` : null,
    lastUsed ? `Last used ${lastUsed}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function SecuritySkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <SettingsRows>
        <SettingsRowSkeleton action={72} label="Password" value={160} />
        <SettingsRowSkeleton
          action={72}
          label="Multi-factor authentication"
          value={220}
        />
      </SettingsRows>
      <SettingsSection
        description="Sign in with your fingerprint, face, or device PIN."
        title="Passkeys"
      >
        <SettingsRows>
          <SettingsRowSkeleton
            action={<SkeletonButton width={32} />}
            description={180}
            label="Passkey"
            leading={<SettingsIconTile icon={Lock} />}
          />
        </SettingsRows>
      </SettingsSection>
    </div>
  );
}

export function SecurityPanel() {
  const queryClient = useQueryClient();
  const meQuery = useWorkOsQuery({
    queryKey: workOsKey("Me"),
    queryFn: (client) => client.Me(),
  });
  const settingsQuery = useWorkOsQuery({
    queryKey: workOsKey("AuthenticationSettings"),
    queryFn: (client) => client.AuthenticationSettings(),
  });
  const passkeysEnabled =
    settingsQuery.data?.authenticationSettings.passkeyAuthEnabled ?? false;
  const passkeysQuery = useWorkOsQuery({
    queryKey: workOsKey("Passkeys"),
    queryFn: (client) => client.Passkeys(),
    enabled: passkeysEnabled,
  });
  const [removing, setRemoving] = useState<Passkey | null>(null);

  if (meQuery.isError) return <SettingsError error={meQuery.error} />;
  if (settingsQuery.isError)
    return <SettingsError error={settingsQuery.error} />;

  // One reveal for the whole tab: wait for the passkeys too when they apply.
  const ready =
    meQuery.data &&
    settingsQuery.data &&
    (!passkeysEnabled || passkeysQuery.data || passkeysQuery.isError)
      ? {
          me: meQuery.data.me,
          settings: settingsQuery.data.authenticationSettings,
        }
      : undefined;

  return (
    <SettingsReveal data={ready} skeleton={<SecuritySkeleton />}>
      {(data) => {
        const profile = data.me;
        const settings = data.settings;
        const policyHint = passwordPolicyHint(settings.passwordPolicy);
        const refreshMe = () =>
          queryClient.invalidateQueries({ queryKey: workOsKey("Me") });
        const refreshPasskeys = () =>
          queryClient.invalidateQueries({ queryKey: workOsKey("Passkeys") });

        const addPasskey = (variant: "primary" | "secondary") => (
          <VerificationSettingsDialog
            description="Sign in with your fingerprint, face, or device PIN instead of a password."
            title="Add a passkey"
            trigger={
              <Button
                leadingIcon={variant === "secondary" ? Plus : undefined}
                type="button"
                variant={variant}
              >
                Add passkey
              </Button>
            }
          >
            {({ close }) => (
              <AddPasskeyFlow
                close={close}
                email={profile.email}
                onAdded={refreshPasskeys}
              />
            )}
          </VerificationSettingsDialog>
        );

        return (
          <div className="flex flex-col gap-10" data-testid="security-panel">
            {settings.passwordAuthEnabled || settings.mfaEnabled ? (
              <SettingsRows>
                {settings.passwordAuthEnabled ? (
                  <SettingsRow
                    label="Password"
                    value={
                      <span className="text-muted-foreground">
                        {profile.passwordSet
                          ? (lastUsedLabel(profile.passwordLastUsedAt) ??
                            "Password is set")
                          : "Set a password to access your account"}
                      </span>
                    }
                  >
                    {profile.passwordSet ? (
                      <SettingsDialog
                        description="Change your account password"
                        title="Change Password"
                        content={(close) => (
                          <ChangePasswordForm
                            close={close}
                            policyHint={policyHint}
                          />
                        )}
                      >
                        <Button type="button" variant="secondary">
                          Change
                        </Button>
                      </SettingsDialog>
                    ) : (
                      <VerificationSettingsDialog
                        description="Set a new password for your account"
                        title="Set a password"
                        trigger={
                          <Button type="button" variant="secondary">
                            Set a password
                          </Button>
                        }
                      >
                        {({ close }) => (
                          <SetPasswordFlow
                            close={close}
                            email={profile.email}
                            onCreated={refreshMe}
                            policyHint={policyHint}
                          />
                        )}
                      </VerificationSettingsDialog>
                    )}
                  </SettingsRow>
                ) : null}
                {settings.mfaEnabled ? (
                  <SettingsRow
                    label="Multi-factor authentication"
                    value={
                      <span className="text-muted-foreground">
                        {profile.mfaEnabled
                          ? [
                              "Authenticator app",
                              lastUsedLabel(profile.mfaLastUsedAt),
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : "Secure your account with an extra verification step"}
                      </span>
                    }
                  >
                    {settings.mfaRequired && !profile.mfaEnabled ? (
                      <SettingsStatus state="warning">Required</SettingsStatus>
                    ) : null}
                    {profile.mfaEnabled ? (
                      <VerificationSettingsDialog
                        description={`Turning off MFA will remove the additional layer of security on your account. ${disableMfaCopy(profile.passwordSet)}`}
                        title="Disable multi-factor authentication?"
                        trigger={
                          <Button type="button" variant="secondary">
                            Disable
                          </Button>
                        }
                      >
                        {({ close }) => (
                          <RemoveAuthenticatorFlow
                            close={close}
                            email={profile.email}
                            onRemoved={refreshMe}
                          />
                        )}
                      </VerificationSettingsDialog>
                    ) : (
                      <VerificationSettingsDialog
                        title="Set up an authenticator app"
                        trigger={
                          <Button type="button" variant="secondary">
                            Set up authenticator app
                          </Button>
                        }
                      >
                        {({ close }) => (
                          <AddAuthenticatorFlow
                            close={close}
                            email={profile.email}
                            onEnrolled={refreshMe}
                          />
                        )}
                      </VerificationSettingsDialog>
                    )}
                  </SettingsRow>
                ) : null}
              </SettingsRows>
            ) : null}

            {passkeysEnabled ? (
              <SettingsSection
                actions={
                  passkeysSupported() &&
                  (passkeysQuery.data?.passkeys.length ?? 0) > 0
                    ? addPasskey("secondary")
                    : null
                }
                description="Sign in with your fingerprint, face, or device PIN."
                title="Passkeys"
              >
                {passkeysQuery.isPending ? (
                  <SettingsRows>
                    <SettingsRowSkeleton
                      action={<SkeletonButton width={32} />}
                      description={180}
                      label="Passkey"
                      leading={<SettingsIconTile icon={Lock} />}
                    />
                  </SettingsRows>
                ) : passkeysQuery.isError ? (
                  <SettingsError error={passkeysQuery.error} />
                ) : passkeysQuery.data.passkeys.length === 0 ? (
                  <SettingsEmpty
                    action={
                      passkeysSupported() ? addPasskey("primary") : undefined
                    }
                    description={
                      passkeysSupported()
                        ? "Add a passkey to sign in with your fingerprint, face, or device PIN instead of a password."
                        : "This browser can’t create passkeys. Try a recent version of Chrome, Safari, or Firefox."
                    }
                    title="No passkeys yet"
                  />
                ) : (
                  <SettingsRows>
                    {passkeysQuery.data.passkeys.map((passkey) => (
                      <SettingsRow
                        description={passkeyDetail(passkey)}
                        key={passkey.id}
                        label="Passkey"
                        leading={<SettingsIconTile icon={Lock} />}
                      >
                        <SettingsRowMenu
                          actions={[
                            {
                              icon: X,
                              label: "Remove",
                              onSelect: () => setRemoving(passkey),
                            },
                          ]}
                          label="Passkey actions"
                        />
                      </SettingsRow>
                    ))}
                  </SettingsRows>
                )}
              </SettingsSection>
            ) : null}

            {removing ? (
              <SettingsDialog
                description="You won’t be able to sign in with this passkey anymore."
                onOpenChange={(open) => {
                  if (!open) setRemoving(null);
                }}
                open
                title="Remove passkey?"
                content={(close) => (
                  <RemovePasskeyFlow
                    close={close}
                    email={profile.email}
                    onRemoved={refreshPasskeys}
                    passkey={removing}
                  />
                )}
              />
            ) : null}
          </div>
        );
      }}
    </SettingsReveal>
  );
}
