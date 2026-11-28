import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuthLayout, authLinkClass } from "../components/auth-layout";
import {
  LinkSent,
  PasswordlessForm,
  linkSentFooter,
} from "../components/passwordless-form";
import { safeRedirect, signedInRedirect } from "../features/auth/safe-redirect";
import { loadAuthOptions, loadSession } from "../features/auth/session";

// Sign-up attribution (PRE-160): the marketing site's sign-up link carries
// the visitor's first-touch utm_* params and referring hostname. This page
// keeps them in a first-party cookie, sent only to /api/auth, for the 30
// minutes a link or Google sign-in takes; apps/api auth.ts
// (SIGNUP_ATTRIBUTION_COOKIE) puts them on signed_up once the account exists.
const ATTRIBUTION = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "referrer_domain",
] as const;
type Attribution = Partial<Record<(typeof ATTRIBUTION)[number], string>>;

const rememberAttribution = (search: Attribution) => {
  const params = new URLSearchParams();
  for (const name of ATTRIBUTION) {
    const value = search[name];
    if (value) params.set(name, value.slice(0, 100));
  }
  if (!params.size) return;
  document.cookie = `preprocess_signup_attribution=${encodeURIComponent(params.toString())}; Path=/api/auth; Max-Age=1800; SameSite=Lax; Secure`;
};

export const Route = createFileRoute("/sign-up")({
  validateSearch: (
    search,
  ): { redirect?: string; email?: string } & Attribution => ({
    ...(typeof search.redirect === "string"
      ? { redirect: search.redirect }
      : {}),
    ...(typeof search.email === "string" ? { email: search.email } : {}),
    ...Object.fromEntries(
      ATTRIBUTION.flatMap((name) =>
        typeof search[name] === "string" ? [[name, search[name]]] : [],
      ),
    ),
  }),
  // Signed-in people skip the form, before it renders (PRE-175).
  beforeLoad: async ({ search }) => {
    if (await loadSession())
      throw redirect({ href: signedInRedirect(search.redirect) });
  },
  loader: () => loadAuthOptions(),
  component: SignUpPage,
});

// Names come right after the link or Google, on the next page, so both ways
// in ask for them the same way.
function SignUpPage() {
  const search = Route.useSearch();
  const { signUpOpen, google, turnstile } = Route.useLoaderData();
  const [sent, setSent] = useState<string | null>(null);
  const next = safeRedirect(search.redirect);
  const invited = next.startsWith("/invitations/");
  useEffect(() => rememberAttribution(search), [search]);

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
        signUpOpen || invited
          ? undefined
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
      terms
      subtitle={
        invited
          ? "Create your account to join."
          : "Start automating complex work."
      }
      title={invited ? "Welcome aboard." : "Create your account."}
    >
      <PasswordlessForm
        defaultEmail={search.email}
        google={google}
        turnstile={turnstile}
        next={next}
        onSent={setSent}
        submitLabel="Sign up"
      />
    </AuthLayout>
  );
}
