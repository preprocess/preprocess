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
import { authPost } from "../features/auth/client";
import { loadSignUpOpen } from "../features/auth/session";

export const Route = createFileRoute("/sign-up")({
  validateSearch: (search): { redirect?: string; email?: string } => ({
    ...(typeof search.redirect === "string"
      ? { redirect: search.redirect }
      : {}),
    ...(typeof search.email === "string" ? { email: search.email } : {}),
  }),
  loader: async () => ({ signUpOpen: await loadSignUpOpen() }),
  component: SignUpPage,
});

const MIN_PASSWORD = 8;

type Fields = { name?: string; email?: string; password?: string };

function validate(name: string, email: string, password: string): Fields {
  return {
    ...(name.trim() ? {} : { name: "Enter your name." }),
    ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      ? {}
      : { email: "Enter an email address, like ada@example.com." }),
    ...(password.length >= MIN_PASSWORD
      ? {}
      : { password: `Use at least ${MIN_PASSWORD} characters.` }),
  };
}

function SignUpPage() {
  const search = Route.useSearch();
  const { signUpOpen } = Route.useLoaderData();
  const submitRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(search.email ?? "");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Fields>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = safeRedirect(search.redirect);
  const invited = next.startsWith("/invitations/");

  async function onSignUp() {
    setError(null);
    const found = validate(name, email, password);
    setErrors(found);
    if (Object.keys(found).length) throw new AsyncActionAbortError();
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
    <AuthLayout
      description={
        signUpOpen || invited
          ? "We'll send you an email to confirm your address."
          : "Joining your team? Use the address your invitation was sent to."
      }
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
      subtitle={
        invited
          ? "Create your account to join."
          : "Start automating complex work."
      }
      title={invited ? "Welcome aboard." : "Create your account."}
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
            autoComplete="name"
            autoFocus
            disabled={pending}
            error={errors.name}
            id="name"
            label="Name"
            onChange={(value) => {
              setName(value);
              setErrors((current) => ({ ...current, name: undefined }));
            }}
            value={name}
          />
          <AuthField
            autoComplete="email"
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
            autoComplete="new-password"
            disabled={pending}
            error={errors.password}
            hint={`At least ${MIN_PASSWORD} characters.`}
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
          onAction={onSignUp}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Creating…"
          successLabel="Created"
          type="submit"
        >
          Create account
        </LoadingButton>
      </form>
    </AuthLayout>
  );
}
