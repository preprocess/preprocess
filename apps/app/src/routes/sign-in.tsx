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
import { ApiError, authPost } from "../features/auth/client";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  component: SignInPage,
});

const required = (label: string) => (value: string) =>
  value.trim() ? null : `Enter your ${label}.`;

function SignInPage() {
  const { redirect } = Route.useSearch();
  const emailRef = useRef<InlineValidationHandle>(null);
  const passwordRef = useRef<InlineValidationHandle>(null);
  const submitRef = useRef<LoadingButtonHandle>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSignIn() {
    setError(null);
    const emailOk = emailRef.current?.commit();
    const passwordOk = passwordRef.current?.commit();
    if (!emailOk || !passwordOk) throw new AsyncActionAbortError();
    try {
      await authPost("/sign-in/email", { email: email.trim(), password });
      window.setTimeout(
        () => window.location.assign(safeRedirect(redirect)),
        600,
      );
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 401
          ? "That email and password don't match an account."
          : cause instanceof Error
            ? cause.message
            : "Could not sign in. Try again.",
      );
      throw cause;
    }
  }

  return (
    <AuthCard
      footer={
        <>
          New to Preprocess?{" "}
          <Link className={authLinkClass} search={{ redirect }} to="/sign-up">
            Create an account
          </Link>
        </>
      }
      title="Sign in"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          submitRef.current?.run();
        }}
      >
        <InlineValidation
          ref={emailRef}
          autoComplete="email"
          autoFocus
          disabled={pending}
          id="email"
          label="Email"
          onChange={setEmail}
          type="email"
          validate={required("email")}
          value={email}
        />
        <InlineValidation
          ref={passwordRef}
          autoComplete="current-password"
          disabled={pending}
          id="password"
          label="Password"
          onChange={setPassword}
          type="password"
          validate={required("password")}
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
          onAction={onSignIn}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Signing in…"
          successLabel="Signed in"
          type="submit"
        >
          Sign in
        </LoadingButton>
      </form>
    </AuthCard>
  );
}
