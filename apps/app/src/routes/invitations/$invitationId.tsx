import { Button } from "@preprocess/ui/components/button";
import { FieldGroup } from "@preprocess/ui/components/field";
import {
  AsyncActionAbortError,
  LoadingButton,
} from "@preprocess/ui/components/loading-button";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AuthLayout, authLinkClass } from "../../components/auth-layout";
import {
  NameFields,
  nameErrors,
  type NameErrors,
} from "../../components/name-fields";
import {
  LinkSent,
  PasswordlessForm,
  linkSentFooter,
} from "../../components/passwordless-form";
import { useAuth } from "../../features/auth/auth-context";
import { authPost } from "../../features/auth/client";
import {
  loadAuthOptions,
  loadInvitation,
  loadInvitationPreview,
  loadSession,
  needsName,
} from "../../features/auth/session";

// Public: a signed-out invitee signs in here by link or Google, comes back
// signed in, enters their name and joins.
export const Route = createFileRoute("/invitations/$invitationId")({
  loader: async ({ params }) => {
    const session = await loadSession();
    if (!session) {
      const [preview, options] = await Promise.all([
        loadInvitationPreview({ data: params.invitationId }),
        loadAuthOptions(),
      ]);
      return {
        session,
        preview,
        google: options.google,
        invitation: null,
        problem: null,
      };
    }
    return {
      session,
      preview: null,
      google: false,
      ...(await loadInvitation({ data: params.invitationId })),
    };
  },
  component: InvitationPage,
});

const ROLE_NAMES = { owner: "an Owner", admin: "an Admin", member: "a Member" };

function Unavailable({
  title,
  description,
  footer,
}: Readonly<{ title: string; description: string; footer?: React.ReactNode }>) {
  return (
    <AuthLayout description={description} footer={footer} title={title}>
      <Button className="w-full" render={<a href="/" />} variant="secondary">
        Go to Preprocess
      </Button>
    </AuthLayout>
  );
}

function InvitationPage() {
  const { invitationId } = Route.useParams();
  const { session, preview, google, invitation, problem } =
    Route.useLoaderData();
  const { signOut } = useAuth();
  const here = `/invitations/${invitationId}`;
  const [sent, setSent] = useState<string | null>(null);
  const [name, setName] = useState({
    firstName: session?.user.firstName ?? "",
    lastName: session?.user.lastName ?? "",
  });
  const [nameErrorsShown, setNameErrors] = useState<NameErrors>({});
  const [error, setError] = useState<string | null>(null);

  if (!session) {
    if (!preview)
      return (
        <Unavailable
          description="This invitation link is not valid. Ask whoever invited you to send a new one."
          title="Invitation unavailable."
        />
      );
    if (preview.status !== "pending")
      return (
        <Unavailable
          description={`This invitation to ${preview.organizationName} has expired, been used or been revoked. Ask ${preview.inviterName} to send a new one.`}
          title="Invitation closed."
        />
      );
    if (sent)
      return (
        <AuthLayout
          footer={linkSentFooter(() => setSent(null))}
          subtitle={`Open it to join ${preview.organizationName}.`}
          title="Check your email."
        >
          <LinkSent email={sent} onBack={() => setSent(null)} />
        </AuthLayout>
      );
    return (
      <AuthLayout
        description={`${preview.inviterName} invited ${preview.email} to join ${preview.organizationName}. Sign in with that address to accept.`}
        subtitle={`Join ${preview.organizationName} on Preprocess.`}
        title="You're invited."
      >
        <PasswordlessForm
          defaultEmail={preview.email}
          google={google}
          next={here}
          onSent={setSent}
          submitLabel="Sign in"
        />
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

  if (!invitation)
    return (
      <Unavailable
        description={problem ?? "This invitation can't be opened."}
        footer={switchAccount}
        title="Invitation unavailable."
      />
    );

  if (invitation.status !== "pending")
    return (
      <Unavailable
        description={`This invitation to ${invitation.organizationName} has already been used or was revoked. Ask whoever invited you to send a new one.`}
        footer={switchAccount}
        title="Invitation closed."
      />
    );

  const askName = needsName(session.user);

  return (
    <AuthLayout
      description={`${invitation.inviterEmail} invited you to join ${invitation.organizationName} as ${ROLE_NAMES[invitation.role]}.${askName ? ` Tell ${invitation.organizationName} who you are.` : ""}`}
      footer={switchAccount}
      subtitle={`Join ${invitation.organizationName} on Preprocess.`}
      title="Welcome aboard."
    >
      <div className="flex flex-col gap-6">
        {askName ? (
          <FieldGroup>
            <NameFields
              errors={nameErrorsShown}
              onChange={(value, field) => {
                setName(value);
                setNameErrors((current) => ({
                  ...current,
                  [field]: undefined,
                }));
              }}
              value={name}
            />
          </FieldGroup>
        ) : null}
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
              if (askName) {
                const found = nameErrors(name);
                setNameErrors(found);
                if (found.firstName || found.lastName)
                  throw new AsyncActionAbortError();
              }
              try {
                if (askName)
                  await authPost("/update-user", {
                    firstName: name.firstName.trim(),
                    lastName: name.lastName.trim(),
                  });
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
            {`Join ${invitation.organizationName}`}
          </LoadingButton>
          <LoadingButton
            className="w-full"
            onAction={async () => {
              await authPost("/organization/reject-invitation", {
                invitationId,
              });
              window.setTimeout(() => window.location.assign("/"), 600);
            }}
            pendingLabel="Declining…"
            successLabel="Declined"
            variant="secondary"
          >
            Decline
          </LoadingButton>
        </div>
      </div>
    </AuthLayout>
  );
}
