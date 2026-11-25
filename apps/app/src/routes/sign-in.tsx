import { FieldGroup } from "@preprocess/ui/components/field";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";

import {
  AuthField,
  AuthLayout,
  authLinkClass,
  safeRedirect,
} from "../components/auth-layout";
import { ApiError, authPost } from "../features/auth/client";
import { loadSignUpOpen } from "../features/auth/session";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  loader: async () => ({ signUpOpen: await loadSignUpOpen() }),
  component: SignInPage,
});

function SignInPage() {
  const { redirect } = Route.useSearch();
  const { signUpOpen } = Route.useLoaderData();
  const submitRef = useRef<LoadingButtonHandle>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {},
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invited = safeRedirect(redirect).startsWith("/invitations/");

  async function onSignIn() {
    setError(null);
    const found = {
      ...(email.trim() ? {} : { email: "Enter your email." }),
      ...(password ? {} : { password: "Enter your password." }),
    };
    setErrors(found);
    if (Object.keys(found).length) throw new AsyncActionAbortError();
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
    <AuthLayout
      footer={
        <>
          {signUpOpen ? "New to Preprocess?" : "Have an invitation?"}{" "}
          <Link className={authLinkClass} search={{ redirect }} to="/sign-up">
            Create an account
          </Link>
        </>
      }
      subtitle={
        invited
          ? "Sign in to accept your invite."
          : "Sign in to your workspace."
      }
      title={invited ? "Welcome aboard." : "Welcome back."}
    >
      <form
        className="flex flex-col gap-6"
        noValidate
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          submitRef.current?.run();
        }}
      >
        <FieldGroup>
          <AuthField
            autoComplete="email"
            autoFocus
            disabled={pending}
            error={errors.email}
            id="email"
            label="Email"
            onChange={(value) => {
              setEmail(value);
              setErrors((current) => ({ ...current, email: undefined }));
            }}
            placeholder="Your email address"
            type="email"
            value={email}
          />
          <AuthField
            autoComplete="current-password"
            disabled={pending}
            error={errors.password}
            id="password"
            label="Password"
            onChange={(value) => {
              setPassword(value);
              setErrors((current) => ({ ...current, password: undefined }));
            }}
            type="password"
            value={password}
          />
        </FieldGroup>
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
    </AuthLayout>
  );
}
