"use client";

// Step-up verification, ported from the WorkOS widgets' ElevatedAccess
// (@workos-inc/widgets): ask before sending a code to the account email,
// verify it, and keep the elevated access token until it expires so the next
// sensitive action in the same visit skips the code.

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
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { useWorkOsSdk } from "../workos-client-api/sdk";
import { expectResultMember } from "../workos-client-api/vendor/client-graphql-result";
import type { AuthenticationSettingsQuery } from "../workos-client-api/vendor/generated";
import {
  SettingsDialog,
  SettingsDialogActions,
  SettingsPanelMessage,
  actionErrorMessage,
} from "./kit";

export type SettingsGraphql = <T>(
  query: string,
  variables?: Record<string, unknown>,
) => Promise<T>;

export function validateRequired(message: string) {
  return (value: string) => (value.trim() ? null : message);
}

export function validateEmail(value: string) {
  const email = value.trim();
  if (!email) return "Enter an email.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email.";
  return null;
}

type PasswordPolicy =
  AuthenticationSettingsQuery["authenticationSettings"]["passwordPolicy"];

export function passwordPolicyHint(policy: PasswordPolicy) {
  const parts = [`at least ${policy.minimumLength} characters`];
  if (policy.requiresUppercase) parts.push("an uppercase letter");
  if (policy.requiresLowercase) parts.push("a lowercase letter");
  if (policy.requiresNumber) parts.push("a number");
  if (policy.requiresSymbol) parts.push("a symbol");
  if (policy.rejectsBreachedPasswords) {
    parts.push("and must not be a known breached password");
  }
  return `Use ${parts.join(", ")}.`;
}

// ── Elevated access token cache ──────────────────────────

const ELEVATED_ERRORS = new Set([
  "ElevatedAccessTokenExpired",
  "ElevatedAccessTokenInvalid",
]);
// Without an expiry from the server, assume WorkOS's five-minute window.
const FALLBACK_LIFETIME_MS = 5 * 60_000;

let elevated: { token: string; expiresAt: number } | null = null;

function currentElevatedToken() {
  if (elevated && elevated.expiresAt - 5_000 > Date.now()) {
    return elevated.token;
  }
  return null;
}

function rememberElevatedAccess(token: string, expiresAt?: string | null) {
  const parsed = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  elevated = {
    token,
    expiresAt: Number.isNaN(parsed)
      ? Date.now() + FALLBACK_LIFETIME_MS
      : parsed,
  };
}

/** True when an action failed because the elevated token is no longer valid. */
export function isElevatedAccessError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "typename" in error &&
    typeof error.typename === "string" &&
    ELEVATED_ERRORS.has(error.typename)
  );
}

export function forgetElevatedAccess() {
  elevated = null;
}

// ── Verification UI ──────────────────────────────────────

/**
 * The dialog around a verified action. `children` renders inside it once
 * open; put an `ElevatedVerifyStep` first in the flow.
 */
export function VerificationSettingsDialog({
  children,
  description,
  title,
  trigger,
}: {
  children: (session: { close: () => void }) => ReactNode;
  description?: string;
  title: string;
  trigger: ReactElement;
}) {
  return (
    <SettingsDialog
      description={description}
      title={title}
      content={(close) => children({ close })}
    >
      {trigger}
    </SettingsDialog>
  );
}

export function VerifyCodeForm({
  hint,
  onCancel,
  onConfirm,
  submitLabel,
}: {
  hint?: string;
  onCancel: () => void;
  onConfirm: (code: string) => Promise<void>;
  submitLabel: string;
}) {
  const codeRef = useRef<InlineValidationHandle>(null);
  const buttonRef = useRef<LoadingButtonHandle>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        buttonRef.current?.run();
      }}
    >
      <InlineValidation
        ref={codeRef}
        autoComplete="one-time-code"
        hint={hint}
        id="verification-code"
        inputMode="numeric"
        label="Verification code"
        name="code"
        onChange={setCode}
        validate={validateRequired("Enter the code.")}
        value={code}
      />
      {error ? (
        <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
      ) : null}
      <SettingsDialogActions onCancel={onCancel} pending={pending}>
        <LoadingButton
          ref={buttonRef}
          onAction={async () => {
            if (!codeRef.current?.commit()) throw new AsyncActionAbortError();
            setError(null);
            try {
              await onConfirm(code.trim());
            } catch (cause) {
              setError(
                actionErrorMessage(cause, "Could not verify that code."),
              );
              throw cause;
            }
          }}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Checking…"
          successLabel="Verified"
          type="submit"
        >
          {submitLabel}
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}

/**
 * Proves recent re-authentication, then hands the elevated access token to
 * `onVerified`. A still-valid token from earlier in the visit is reused
 * without sending a code; if the action rejects it as expired, the step asks
 * again.
 */
export function ElevatedVerifyStep({
  email,
  onCancel,
  onVerified,
}: {
  email: string;
  onCancel: () => void;
  onVerified: (token: string) => Promise<void> | void;
}) {
  const sdk = useWorkOsSdk();
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [reusing, setReusing] = useState(() => currentElevatedToken() !== null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sendRef = useRef<LoadingButtonHandle>(null);
  const onVerifiedRef = useRef(onVerified);
  onVerifiedRef.current = onVerified;

  async function finish(token: string) {
    try {
      await onVerifiedRef.current(token);
    } catch (cause) {
      if (!isElevatedAccessError(cause)) throw cause;
      forgetElevatedAccess();
      setChallengeId(null);
      setExpired(true);
    }
  }

  useEffect(() => {
    if (!reusing) return;
    const token = currentElevatedToken();
    if (!token) {
      setReusing(false);
      return;
    }
    void finish(token)
      .catch((cause: unknown) => {
        setError(actionErrorMessage(cause, "Something went wrong."));
      })
      .finally(() => setReusing(false));
    // Runs once, on open: the cached token is read at mount.
  }, []);

  if (reusing) {
    return <SettingsPanelMessage>Continuing…</SettingsPanelMessage>;
  }

  if (challengeId) {
    return (
      <VerifyCodeForm
        hint={`A verification code was sent to ${email}. Please enter it below.`}
        onCancel={onCancel}
        onConfirm={async (code) => {
          const data = await sdk.VerifyCurrentEmail({
            input: { authenticationChallengeId: challengeId, code },
          });
          const verified = expectResultMember(
            data.verifyCurrentEmail,
            "CurrentEmailVerified",
          );
          rememberElevatedAccess(
            verified.elevatedAccessToken,
            verified.expiresAt,
          );
          await finish(verified.elevatedAccessToken);
        }}
        submitLabel="Confirm"
      />
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        sendRef.current?.run();
      }}
    >
      <div className="flex flex-col gap-1">
        <p
          className="text-body text-foreground"
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {expired
            ? "Your verification token has expired"
            : "Verify your identity"}
        </p>
        <p className="text-body text-muted-foreground">
          To continue, we need to confirm your identity. We’ll send a temporary
          verification code to <span className="text-foreground">{email}</span>.
        </p>
      </div>
      {error ? (
        <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
      ) : null}
      <SettingsDialogActions onCancel={onCancel} pending={pending}>
        <LoadingButton
          ref={sendRef}
          onAction={async () => {
            setError(null);
            try {
              const data = await sdk.SendVerificationCode();
              const sent = expectResultMember(
                data.sendVerificationCode,
                "VerificationCodeSent",
              );
              setChallengeId(sent.authenticationChallengeId);
            } catch (cause) {
              setError(
                actionErrorMessage(
                  cause,
                  "Could not send a verification code.",
                ),
              );
              throw cause;
            }
          }}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Sending…"
          successLabel="Sent"
          type="submit"
        >
          Send verification code
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}
