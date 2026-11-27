import { Button } from "@preprocess/ui/components/button";
import { FieldGroup } from "@preprocess/ui/components/field";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  AuthField,
  AuthLayout,
  authLinkClass,
} from "../components/auth-layout";
import { useAuth } from "../features/auth/auth-context";
import { ApiError, authPost } from "../features/auth/client";
import { loadDeviceCode, type DeviceCode } from "../features/auth/session";

// Approves `preprocess login`. The root loader sends a signed-out person to
// sign in and back here with the code.
export const Route = createFileRoute("/device")({
  validateSearch: (search): { user_code?: string } =>
    typeof search.user_code === "string" && search.user_code
      ? { user_code: search.user_code }
      : {},
  loaderDeps: ({ search }) => ({ userCode: search.user_code }),
  loader: ({ deps }) =>
    deps.userCode ? loadDeviceCode({ data: deps.userCode }) : null,
  component: DevicePage,
});

const TITLE = "Sign in to the Preprocess CLI";

const PROBLEMS = {
  invalid: "That code isn't valid. Check the code in your terminal.",
  expired: (
    <>
      That code has expired. Run{" "}
      <code className="font-mono">preprocess login</code> again.
    </>
  ),
  used: (
    <>
      That code was already used. Run{" "}
      <code className="font-mono">preprocess login</code> again.
    </>
  ),
};

const normalize = (code: string) =>
  code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

/** XXXX-XXXX, as the terminal shows it. */
const formatCode = (code: string) => {
  const plain = normalize(code);
  return plain.length === 8 ? `${plain.slice(0, 4)}-${plain.slice(4)}` : plain;
};

function DevicePage() {
  const device = Route.useLoaderData();
  return <DeviceCodeAnswer key={device?.userCode} device={device} />;
}

function DeviceCodeAnswer({ device }: Readonly<{ device: DeviceCode | null }>) {
  const { user } = useAuth();
  const [answer, setAnswer] = useState<"approved" | "denied" | null>(null);
  const [problem, setProblem] = useState<keyof typeof PROBLEMS | null>(null);

  const signedInAs = user ? (
    <>
      Signed in as {user.email}.{" "}
      <button
        className={authLinkClass}
        onClick={() =>
          void authPost("/sign-out").then(() =>
            window.location.assign(
              `/sign-in?${new URLSearchParams({ redirect: `${window.location.pathname}${window.location.search}` })}`,
            ),
          )
        }
        type="button"
      >
        Use a different account
      </button>
    </>
  ) : undefined;

  const state = answer ?? problem ?? device?.state;

  if (state === "approved")
    return (
      <Done
        description="Return to your terminal. You can close this tab."
        title="You're signed in"
      />
    );
  if (state === "denied")
    return (
      <Done
        description="The CLI wasn't signed in. You can close this tab."
        title="Sign-in denied"
      />
    );

  if (!device || state !== "pending")
    return (
      <AuthLayout
        description="Enter the code shown in your terminal."
        footer={signedInAs}
        title={TITLE}
      >
        <CodeForm
          defaultCode={device ? formatCode(device.userCode) : ""}
          problem={state && state !== "pending" ? PROBLEMS[state] : undefined}
        />
      </AuthLayout>
    );

  const answerWith = async (choice: "approve" | "deny") => {
    try {
      await authPost(`/device/${choice}`, { userCode: device.userCode });
      window.setTimeout(
        () => setAnswer(choice === "approve" ? "approved" : "denied"),
        600,
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.status < 500)
        window.setTimeout(
          () =>
            setProblem(cause.message === "expired_token" ? "expired" : "used"),
          600,
        );
      throw cause;
    }
  };

  return (
    <AuthLayout
      description="Check that this code matches the one in your terminal, then approve."
      footer={signedInAs}
      title={TITLE}
    >
      <div className="flex flex-col gap-6">
        <p
          aria-label={`Code ${formatCode(device.userCode).split("").join(" ")}`}
          className="rounded-2xl border border-border py-5 text-center font-mono text-title tracking-[0.2em] text-foreground"
        >
          {formatCode(device.userCode)}
        </p>
        <div className="flex flex-col gap-3">
          <LoadingButton
            className="w-full"
            onAction={() => answerWith("approve")}
            pendingLabel="Approving…"
            successLabel="Approved"
          >
            Approve
          </LoadingButton>
          <LoadingButton
            className="w-full"
            onAction={() => answerWith("deny")}
            pendingLabel="Denying…"
            successLabel="Denied"
            variant="secondary"
          >
            Deny
          </LoadingButton>
        </div>
      </div>
    </AuthLayout>
  );
}

function CodeForm({
  defaultCode,
  problem,
}: Readonly<{ defaultCode: string; problem?: ReactNode }>) {
  const navigate = useNavigate();
  const continueRef = useRef<LoadingButtonHandle>(null);
  const [code, setCode] = useState(defaultCode);
  const [error, setError] = useState(problem);

  return (
    <form
      className="flex flex-col gap-6"
      noValidate
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        continueRef.current?.run();
      }}
    >
      <FieldGroup>
        <AuthField
          autoCapitalize="characters"
          autoComplete="one-time-code"
          autoFocus
          className="font-mono tracking-[0.2em]"
          error={error}
          id="user-code"
          label="Code"
          maxLength={9}
          onChange={(value) => {
            setCode(value.toUpperCase());
            setError(undefined);
          }}
          placeholder="XXXX-XXXX"
          spellCheck={false}
          value={code}
        />
      </FieldGroup>
      <LoadingButton
        ref={continueRef}
        className="w-full"
        onAction={async () => {
          const userCode = normalize(code);
          if (userCode.length !== 8) {
            setError("Enter the 8 characters shown in your terminal.");
            throw new AsyncActionAbortError();
          }
          await navigate({ to: "/device", search: { user_code: userCode } });
        }}
        pendingLabel="Checking…"
        type="submit"
      >
        Continue
      </LoadingButton>
    </form>
  );
}

function Done({
  title,
  description,
}: Readonly<{ title: string; description: string }>) {
  return (
    <AuthLayout description={description} title={title}>
      <Button className="w-full" render={<a href="/" />} variant="secondary">
        Go to Preprocess
      </Button>
    </AuthLayout>
  );
}
