import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { AuthLayout, authLinkClass } from "../components/auth-layout";
import {
  LinkSent,
  PasswordlessForm,
  linkSentFooter,
} from "../components/passwordless-form";
import { safeRedirect, signedInRedirect } from "../features/auth/safe-redirect";
import { loadAuthOptions, loadSession } from "../features/auth/session";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search): { redirect?: string; error?: string } => ({
    ...(typeof search.redirect === "string"
      ? { redirect: search.redirect }
      : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  // Signed-in people skip the form, before it renders (PRE-175).
  beforeLoad: async ({ search }) => {
    if (await loadSession())
      throw redirect({ href: signedInRedirect(search.redirect) });
  },
  loader: () => loadAuthOptions(),
  component: SignInPage,
});

function SignInPage() {
  const { redirect, error } = Route.useSearch();
  const { signUpOpen, google, turnstile } = Route.useLoaderData();
  const [sent, setSent] = useState<string | null>(null);
  const next = safeRedirect(redirect);
  const invited = next.startsWith("/invitations/");

  if (sent)
    return (
      <AuthLayout
        footer={linkSentFooter(() => setSent(null))}
        title="Check your email."
      >
        <LinkSent email={sent} onBack={() => setSent(null)} />
      </AuthLayout>
    );

  return (
    <AuthLayout
      description={
        error ? (
          <span className="text-destructive" role="alert">
            That sign-in didn't work. The link may have expired or been used
            already. Try again.
          </span>
        ) : undefined
      }
      footer={
        <>
          {signUpOpen ? "New to Preprocess?" : "Have an invitation?"}{" "}
          <Link className={authLinkClass} search={{ redirect }} to="/sign-up">
            Create an account
          </Link>
        </>
      }
      terms
      subtitle={
        invited
          ? "Sign in to accept your invite."
          : "Sign in to your workspace."
      }
      title={invited ? "Welcome aboard." : "Welcome back."}
    >
      <PasswordlessForm
        google={google}
        turnstile={turnstile}
        next={next}
        onSent={setSent}
        submitLabel="Sign in"
      />
    </AuthLayout>
  );
}
