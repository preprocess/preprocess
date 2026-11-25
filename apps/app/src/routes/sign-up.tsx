import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";

import { AuthCard, authLinkClass, safeRedirect } from "../components/auth-card";
import { authPost } from "../features/auth/client";

export const Route = createFileRoute("/sign-up")({
  validateSearch: (search): { redirect?: string; email?: string } => ({
    ...(typeof search.redirect === "string"
      ? { redirect: search.redirect }
      : {}),
    ...(typeof search.email === "string" ? { email: search.email } : {}),
  }),
  component: SignUpPage,
});

const MIN_PASSWORD = 8;

function validateName(value: string) {
  return value.trim() ? null : "Enter your name.";
}

function validateEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? null
    : "Enter an email address, like ada@example.com.";
}

function validatePassword(value: string) {
  return value.length >= MIN_PASSWORD
    ? null
    : `Use at least ${MIN_PASSWORD} characters.`;
}

function SignUpPage() {
  const search = Route.useSearch();
  const nameRef = useRef<InlineValidationHandle>(null);
  const emailRef = useRef<InlineValidationHandle>(null);
  const passwordRef = useRef<InlineValidationHandle>(null);
  const submitRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(search.email ?? "");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = safeRedirect(search.redirect);

  async function onSignUp() {
    setError(null);
    const checks = [nameRef, emailRef, passwordRef].map((ref) =>
      ref.current?.commit(),
    );
    if (!checks.every(Boolean)) throw new AsyncActionAbortError();
    try {
      // Signing up signs you in. The verification email links back to `next`.
      await authPost("/sign-up/email", {
        name: name.trim(),
        email: email.trim(),
        password,
        callbackURL: next,
      });
      window.setTimeout(() => window.location.assign(next), 600);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create your account. Try again.",
      );
      throw cause;
    }
  }

  return (
    <AuthCard
      description="We'll send you an email to confirm your address."
      footer={
        <>
          Already have an account?{" "}
          <Link
            className={authLinkClass}
            search={{ redirect: search.redirect }}
            to="/sign-in"
          >
            Sign in
          </Link>
        </>
      }
      title="Create your account"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          submitRef.current?.run();
        }}
      >
        <InlineValidation
          ref={nameRef}
          autoComplete="name"
          autoFocus
          disabled={pending}
          id="name"
          label="Name"
          onChange={setName}
          validate={validateName}
          value={name}
        />
        <InlineValidation
          ref={emailRef}
          autoComplete="email"
          disabled={pending}
          id="email"
          label="Email"
          onChange={setEmail}
          type="email"
          validate={validateEmail}
          value={email}
        />
        <InlineValidation
          ref={passwordRef}
          autoComplete="new-password"
          disabled={pending}
          hint={`At least ${MIN_PASSWORD} characters.`}
          id="password"
          label="Password"
          onChange={setPassword}
          type="password"
          validate={validatePassword}
          value={password}
        />
        {error ? (
          <p className="text-body text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <LoadingButton
          ref={submitRef}
          className="w-full"
          errorLabel="Try again"
          onAction={onSignUp}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Creating…"
          successLabel="Created"
          type="submit"
        >
          Create account
        </LoadingButton>
      </form>
    </AuthCard>
  );
}
