import { Button } from "@preprocess/ui/components/button";
import { FieldGroup } from "@preprocess/ui/components/field";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { useRef, useState, type FormEvent } from "react";

import { authPost } from "../features/auth/client";
import { AuthField, authLinkClass } from "./auth-layout";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The two ways in, with no password: Google (where the install configured
 * it) or a link emailed to the address. Both create the account on first use
 * and bring the person back to `next`.
 */
export function PasswordlessForm({
  next,
  google,
  defaultEmail = "",
  onSent,
}: Readonly<{
  next: string;
  google: boolean;
  defaultEmail?: string;
  /** The address the link went to, or null to ask again. */
  onSent: (email: string | null) => void;
}>) {
  const sendRef = useRef<LoadingButtonHandle>(null);
  const [email, setEmail] = useState(defaultEmail);
  const [emailError, setEmailError] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [opening, setOpening] = useState(false);
  const failed = `/sign-in?${new URLSearchParams({ redirect: next, error: "link" })}`;

  async function onSend() {
    setError(null);
    const address = email.trim();
    if (!EMAIL.test(address)) {
      setEmailError("Enter an email address, like ada@example.com.");
      throw new AsyncActionAbortError();
    }
    try {
      await authPost("/sign-in/magic-link", {
        email: address,
        callbackURL: next,
        newUserCallbackURL: next,
        errorCallbackURL: failed,
      });
      window.setTimeout(() => onSent(address), 600);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not send the link.",
      );
      throw cause;
    }
  }

  async function onGoogle() {
    setError(null);
    setOpening(true);
    try {
      const { url } = await authPost<{ url: string }>("/sign-in/social", {
        provider: "google",
        callbackURL: next,
        newUserCallbackURL: next,
        errorCallbackURL: failed,
      });
      window.location.assign(url);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not reach Google.",
      );
      setOpening(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {google ? (
        <>
          <Button
            className="w-full"
            disabled={pending || opening}
            onClick={() => void onGoogle()}
            variant="secondary"
          >
            <span className="inline-flex items-center gap-2">
              <GoogleMark />
              {opening ? "Opening Google…" : "Continue with Google"}
            </span>
          </Button>
          <div className="flex items-center gap-3 text-body text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}
      <form
        className="flex flex-col gap-6"
        noValidate
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          sendRef.current?.run();
        }}
      >
        <FieldGroup>
          <AuthField
            autoComplete="email"
            autoFocus={!defaultEmail}
            disabled={pending}
            error={emailError}
            id="email"
            label="Email"
            onChange={(value) => {
              setEmail(value);
              setEmailError(undefined);
            }}
            placeholder="Your email address"
            type="email"
            value={email}
          />
        </FieldGroup>
        {error ? (
          <p className="text-body text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <LoadingButton
          ref={sendRef}
          className="w-full"
          errorLabel="Try again"
          onAction={onSend}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Sending…"
          successLabel="Sent"
          type="submit"
        >
          Email me a sign-in link
        </LoadingButton>
      </form>
    </div>
  );
}

/** What the person sees once the link is on its way. */
export function LinkSent({
  email,
  onBack,
}: Readonly<{ email: string; onBack: () => void }>) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-subtitle text-muted-foreground" role="status">
        We sent a sign-in link to{" "}
        <span className="text-foreground">{email}</span>. It works once and
        expires in 15 minutes.
      </p>
      <Button className="w-full" onClick={onBack} variant="secondary">
        Use a different email
      </Button>
    </div>
  );
}

export const linkSentFooter = (onBack: () => void) => (
  <>
    Didn't get it? Check spam, or{" "}
    <button className={authLinkClass} onClick={onBack} type="button">
      send another
    </button>
    .
  </>
);

/** Google's own "G", which its brand rules ask for on the button. */
function GoogleMark() {
  return (
    <svg aria-hidden className="size-4" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
        fill="#EA4335"
      />
    </svg>
  );
}
