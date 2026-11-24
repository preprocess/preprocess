import { Button } from "@preprocess/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@preprocess/ui/components/dialog";
import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import { useRef, useState, type FormEvent } from "react";

import { createUserOrganization } from "../features/organizations/user-organizations";
import { validateOrganizationName } from "../server/organization-name";

function validateOrgName(value: string) {
  const result = validateOrganizationName(value);
  return result.ok ? null : result.error;
}

function CreateOrganizationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createOrg = useServerFn(createUserOrganization);
  const { switchToOrganization } = useAuth();
  const nameFieldRef = useRef<InlineValidationHandle>(null);
  const createRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createRef.current?.run();
  }

  async function onCreate() {
    setError(null);

    if (!nameFieldRef.current?.commit()) {
      throw new AsyncActionAbortError();
    }

    try {
      const { organizationId } = await createOrg({ data: { name } });
      const switched = await switchToOrganization(organizationId);
      if (switched && "error" in switched && switched.error) {
        throw new Error(switched.error);
      }
      window.location.reload();
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) {
          setName("");
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Use your company or team name. This can be changed later.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <InlineValidation
            ref={nameFieldRef}
            autoComplete="organization"
            autoFocus
            disabled={pending}
            hint="Your team will see this name."
            id="create-organization-name"
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
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <LoadingButton
              ref={createRef}
              errorLabel="Try again"
              onAction={onCreate}
              onStatusChange={(status) => setPending(status === "pending")}
              pendingLabel="Creating…"
              successLabel="Created"
              type="submit"
            >
              Create
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { CreateOrganizationDialog };
