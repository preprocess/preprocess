import { FieldGroup } from "@preprocess/ui/components/field";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { useRef, useState, type FormEvent } from "react";

import { useAuth } from "../features/auth/auth-context";
import { freeCheckout } from "../features/organizations/billing";
import { createOrganization } from "../features/organizations/user-organizations";
import { validateOrganizationName } from "../server/organization-name";
import { AuthField, AuthLayout, authLinkClass } from "./auth-layout";

function OnboardingCreateOrg({ email }: Readonly<{ email: string }>) {
  const { signOut } = useAuth();
  const continueRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    continueRef.current?.run();
  }

  async function onContinue() {
    setError(null);

    const checked = validateOrganizationName(name);
    setNameError(checked.ok ? undefined : checked.error);
    if (!checked.ok) throw new AsyncActionAbortError();

    try {
      const { organizationId } = await createOrganization(name);
      const checkout = await freeCheckout(organizationId);
      // Let LoadingButton show success, then hard-navigate for a fresh load.
      window.setTimeout(() => {
        window.location.assign(checkout ?? "/");
      }, 1100);
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Could not create the organization. Try again.";
      setError(message);
      throw cause;
    }
  }

  return (
    <AuthLayout
      description="Use your company or team name. This can be changed later."
      footer={
        <>
          Signed in as {email}.{" "}
          <button
            className={authLinkClass}
            onClick={() => void signOut()}
            type="button"
          >
            Use a different account
          </button>
        </>
      }
      title="Name your organization."
    >
      <form
        className="flex flex-col gap-6"
        data-testid="onboarding-create-org"
        noValidate
        onSubmit={onSubmit}
      >
        <FieldGroup>
          <AuthField
            autoComplete="organization"
            autoFocus
            disabled={pending}
            error={nameError}
            hint="Your team will see this name."
            id="organization-name"
            label="Organization name"
            name="name"
            onChange={(value) => {
              setName(value);
              setNameError(undefined);
            }}
            placeholder="Acme"
            value={name}
          />
        </FieldGroup>

        {error ? (
          <p className="text-body text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <LoadingButton
          ref={continueRef}
          className="w-full"
          errorLabel="Try again"
          onAction={onContinue}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Creating…"
          successLabel="Created"
          type="submit"
        >
          Continue
        </LoadingButton>
      </form>
    </AuthLayout>
  );
}

export { OnboardingCreateOrg };
