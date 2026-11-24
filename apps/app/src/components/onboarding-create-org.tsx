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
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import { useRef, useState, type FormEvent } from "react";

import { createOrganization } from "../features/onboarding/create-organization";
import { validateOrganizationName } from "../server/organization-name";
import { PreprocessMark } from "./preprocess-mark";

function validateOrgName(value: string) {
  const result = validateOrganizationName(value);
  return result.ok ? null : result.error;
}

function OnboardingCreateOrg({ email }: Readonly<{ email: string }>) {
  const createOrg = useServerFn(createOrganization);
  const { switchToOrganization } = useAuth();
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
      // Server returns JSON only — Start RPC rejects bare redirect Responses.
      const { organizationId } = await createOrg({ data: { name } });
      const switched = await switchToOrganization(organizationId);
      if (switched && "error" in switched && switched.error) {
        throw new Error(switched.error);
      }
      // Let LoadingButton show success, then hard-navigate for a fresh auth load.
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
      {/* Mirror AuthKit `.ak-Content` panel from authkit/workos-authkit.css */}
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
          <a
            className="text-foreground underline-offset-4 hover:underline"
            href="/api/auth/sign-out"
          >
            Use a different account
          </a>
        </p>
      </div>
    </div>
  );
}

export { OnboardingCreateOrg };
