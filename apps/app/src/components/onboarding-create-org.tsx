import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { useRef, useState, type FormEvent } from "react";

import { useAuth } from "../features/auth/auth-context";
import { createOrganization } from "../features/organizations/user-organizations";
import { validateOrganizationName } from "../server/organization-name";
import { PreprocessMark } from "./preprocess-mark";

function validateOrgName(value: string) {
  const result = validateOrganizationName(value);
  return result.ok ? null : result.error;
}

function OnboardingCreateOrg({ email }: Readonly<{ email: string }>) {
  const { signOut } = useAuth();
  const nameFieldRef = useRef<InlineValidationHandle>(null);
  const continueRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    continueRef.current?.run();
  }

  async function onContinue() {
    setError(null);

    if (!nameFieldRef.current?.commit()) {
      throw new AsyncActionAbortError();
    }

    try {
      await createOrganization(name);
      // Let LoadingButton show success, then hard-navigate for a fresh load.
      window.setTimeout(() => {
        window.location.assign("/");
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
    <div
      className="flex h-svh items-center justify-center overflow-hidden bg-background"
      data-testid="onboarding-create-org"
    >
      <div className="w-[min(calc(100%-48px),360px)] bg-surface-3 p-8 shadow-surface-3">
        <header className="mb-7 flex flex-col items-start gap-2">
          <PreprocessMark className="mb-3 size-7" title="Preprocess" />
          <h1
            className="w-full text-left text-display leading-normal tracking-[-0.03em] text-foreground"
            style={{ fontVariationSettings: fontWeights.semibold }}
          >
            Name your organization
          </h1>
          <p className="w-full text-left text-subtitle leading-normal text-muted-foreground">
            Use your company or team name. This can be changed later.
          </p>
        </header>

        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <InlineValidation
            ref={nameFieldRef}
            autoComplete="organization"
            autoFocus
            disabled={pending}
            hint="Your team will see this name."
            id="organization-name"
            label="Organization name"
            name="name"
            onChange={setName}
            placeholder="Acme"
            validate={validateOrgName}
            value={name}
          />

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

        <p className="mt-6 text-center text-body text-muted-foreground">
          Signed in as {email}.{" "}
          <button
            className="text-foreground underline-offset-4 hover:underline"
            onClick={() => void signOut()}
            type="button"
          >
            Use a different account
          </button>
        </p>
      </div>
    </div>
  );
}

export { OnboardingCreateOrg };
