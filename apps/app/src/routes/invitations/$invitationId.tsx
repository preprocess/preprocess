import { Button } from "@preprocess/ui/components/button";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AuthLayout, authLinkClass } from "../../components/auth-layout";
import { useAuth } from "../../features/auth/auth-context";
import { authPost } from "../../features/auth/client";
import { loadInvitation, loadSession } from "../../features/auth/session";

// Public: a signed-out invitee chooses to sign up or sign in, and comes back
// here signed in to accept.
export const Route = createFileRoute("/invitations/$invitationId")({
  loader: async ({ params }) => {
    const session = await loadSession();
    // Better Auth shows an invitation only to a verified address.
    if (!session?.user.emailVerified)
      return { session, invitation: null, problem: null };
    return {
      session,
      ...(await loadInvitation({ data: params.invitationId })),
    };
  },
  component: InvitationPage,
});

const ROLE_NAMES = { owner: "an Owner", admin: "an Admin", member: "a Member" };

function InvitationPage() {
  const { invitationId } = Route.useParams();
  const { session, invitation, problem } = Route.useLoaderData();
  const { signOut } = useAuth();
  const here = `/invitations/${invitationId}`;
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  if (!session) {
    return (
      <AuthLayout
        description="Create an account with the email address the invitation was sent to, or sign in if you already have one."
        footer={
          <>
            Already have an account?{" "}
            <Link
              className={authLinkClass}
              search={{ redirect: here }}
              to="/sign-in"
            >
              Sign in
            </Link>
          </>
        }
        subtitle="Join your team on Preprocess."
        title="You're invited."
      >
        <Button
          className="w-full"
          render={<Link search={{ redirect: here }} to="/sign-up" />}
        >
          Create account
        </Button>
      </AuthLayout>
    );
  }

  const switchAccount = (
    <>
      Signed in as {session.user.email}.{" "}
      <button
        className={authLinkClass}
        onClick={() => void signOut()}
        type="button"
      >
        Use a different account
      </button>
    </>
  );

  if (!session.user.emailVerified) {
    return (
      <AuthLayout
        description={`Before you can join, confirm your email address with the link we sent to ${session.user.email}.`}
        footer={switchAccount}
        title="Confirm your email."
      >
        <div className="flex flex-col gap-4">
          {resent ? (
            <p className="text-body text-muted-foreground" role="status">
              We sent a new link. It brings you back here.
            </p>
          ) : null}
          <LoadingButton
            className="w-full"
            onAction={async () => {
              await authPost("/send-verification-email", {
                email: session.user.email,
                callbackURL: here,
              });
              setResent(true);
            }}
            pendingLabel="Sending…"
            successLabel="Sent"
          >
            Send the link again
          </LoadingButton>
        </div>
      </AuthLayout>
    );
  }

  if (!invitation) {
    return (
      <AuthLayout
        description={problem ?? "This invitation can't be opened."}
        footer={switchAccount}
        title="Invitation unavailable."
      >
        <Button className="w-full" render={<a href="/" />} variant="secondary">
          Go to Preprocess
        </Button>
      </AuthLayout>
    );
  }

  if (invitation.status !== "pending") {
    return (
      <AuthLayout
        description="This invitation has already been used or was revoked. Ask whoever invited you to send a new one."
        footer={switchAccount}
        title="Invitation closed."
      >
        <Button className="w-full" render={<a href="/" />} variant="secondary">
          Go to Preprocess
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      description={`${invitation.inviterEmail} invited you to join as ${ROLE_NAMES[invitation.role]}.`}
      footer={switchAccount}
      subtitle={`Join ${invitation.organizationName} on Preprocess.`}
      title="Welcome aboard."
    >
      <div className="flex flex-col gap-3">
        {error ? (
          <p className="text-body text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <LoadingButton
          className="w-full"
          onAction={async () => {
            setError(null);
            try {
              const accepted = await authPost<{
                member: { organizationId: string };
              }>("/organization/accept-invitation", { invitationId });
              await authPost("/organization/set-active", {
                organizationId: accepted.member.organizationId,
              });
              window.setTimeout(() => window.location.assign("/"), 600);
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : "Could not join.",
              );
              throw cause;
            }
          }}
          pendingLabel="Joining…"
          successLabel="Joined"
        >
          Accept invitation
        </LoadingButton>
        <LoadingButton
          className="w-full"
          onAction={async () => {
            await authPost("/organization/reject-invitation", { invitationId });
            window.setTimeout(() => window.location.assign("/"), 600);
          }}
          pendingLabel="Declining…"
          successLabel="Declined"
          variant="secondary"
        >
          Decline
        </LoadingButton>
      </div>
    </AuthLayout>
  );
}
