import { FieldGroup } from "@preprocess/ui/components/field";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";

import { AuthLayout, authLinkClass } from "../components/auth-layout";
import {
  NameFields,
  nameErrors,
  type NameErrors,
} from "../components/name-fields";
import { useAuth } from "../features/auth/auth-context";
import { authPost } from "../features/auth/client";
import { safeRedirect } from "../features/auth/safe-redirect";

// The root loader sends anyone signed in without a first and last name here
// first, whichever way they came in.
export const Route = createFileRoute("/onboarding_/name")({
  validateSearch: (search): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  component: NamePage,
});

function NamePage() {
  const { redirect } = Route.useSearch();
  const { user, signOut } = useAuth();
  const continueRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState({
    firstName: user?.firstName ?? "",
    lastName: user?.lastName ?? "",
  });
  const [errors, setErrors] = useState<NameErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onContinue() {
    setError(null);
    const found = nameErrors(name);
    setErrors(found);
    if (found.firstName || found.lastName) throw new AsyncActionAbortError();
    try {
      await authPost("/update-user", {
        firstName: name.firstName.trim(),
        lastName: name.lastName.trim(),
      });
      window.setTimeout(
        () => window.location.assign(safeRedirect(redirect)),
        600,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save your name.",
      );
      throw cause;
    }
  }

  return (
    <AuthLayout
      description="Your team sees this name on cases, reviews and comments."
      footer={
        <>
          Signed in as {user?.email}.{" "}
          <button
            className={authLinkClass}
            onClick={() => void signOut()}
            type="button"
          >
            Use a different account
          </button>
        </>
      }
      title="What's your name?"
    >
      <form
        className="flex flex-col gap-6"
        noValidate
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          continueRef.current?.run();
        }}
      >
        <FieldGroup>
          <NameFields
            disabled={pending}
            errors={errors}
            onChange={(value, field) => {
              setName(value);
              setErrors((current) => ({ ...current, [field]: undefined }));
            }}
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
          pendingLabel="Saving…"
          successLabel="Saved"
          type="submit"
        >
          Continue
        </LoadingButton>
      </form>
    </AuthLayout>
  );
}
