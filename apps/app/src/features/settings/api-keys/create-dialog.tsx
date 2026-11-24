"use client";

// Create an API key, ported from the WorkOS create-api-key and
// create-user-api-key widgets: name, expiration, and the permissions to
// grant, then the secret shown exactly once.

import { Banner, BannerDescription } from "@preprocess/ui/components/banner";
import { Button } from "@preprocess/ui/components/button";
import {
  CheckboxGroup,
  CheckboxItem,
} from "@preprocess/ui/components/checkbox-group";
import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import { InputCopy } from "@preprocess/ui/components/input-copy";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { Search } from "@preprocess/ui/lib/icons";
import { useMemo, useRef, useState, type FormEvent } from "react";

import { SettingsDialogShell, SettingsSearchField } from "../kit";
import {
  useApiKeyPermissions,
  useCreateApiKey,
  type ApiKeyPermission,
  type ApiKeyScope,
} from "./data";
import {
  ExpirationSelect,
  expiresAtFor,
  type ExpirationOption,
} from "./expiration";
import { ActionErrorBanner } from "./parts";

export function CreateApiKeyDialog({
  scope,
  open,
  onOpenChange,
}: {
  scope: ApiKeyScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [secret, setSecret] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) setSecret(null);
    onOpenChange(next);
  };

  return (
    <SettingsDialogShell
      description={
        secret
          ? "Please save this API key in a secure location. If you lose it, you'll need to generate a new one."
          : undefined
      }
      onOpenChange={handleOpenChange}
      open={open}
      size="lg"
      title={secret ? "Save your key" : "Create API key"}
    >
      {!open ? null : secret ? (
        <SaveApiKey close={() => handleOpenChange(false)} secret={secret} />
      ) : (
        <CreateApiKeyForm
          close={() => handleOpenChange(false)}
          onCreated={setSecret}
          scope={scope}
        />
      )}
    </SettingsDialogShell>
  );
}

function CreateApiKeyForm({
  scope,
  close,
  onCreated,
}: {
  scope: ApiKeyScope;
  close: () => void;
  onCreated: (secret: string) => void;
}) {
  const nameRef = useRef<InlineValidationHandle>(null);
  const submitRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState("");
  const [expiration, setExpiration] = useState<ExpirationOption>("never");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const permissions = useApiKeyPermissions(scope);
  const createApiKey = useCreateApiKey(scope);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        submitRef.current?.run();
      }}
    >
      {createApiKey.error ? (
        <ActionErrorBanner>
          An error occurred while creating the API key.
        </ActionErrorBanner>
      ) : null}
      <InlineValidation
        ref={nameRef}
        autoComplete="off"
        autoFocus
        id={`${scope}-api-key-name`}
        label="Name"
        name="name"
        onChange={setName}
        placeholder="A descriptive name for the API key"
        validate={(value) => (value.trim() ? null : "The name is required")}
        value={name}
      />
      <ExpirationSelect onValueChange={setExpiration} value={expiration} />
      {permissions.isError ? (
        <Banner role="status" status="warning">
          <BannerDescription>
            Permissions are unavailable right now. You can still create an API
            key without selecting permissions.
          </BannerDescription>
        </Banner>
      ) : null}
      {permissions.isSuccess && permissions.data.length > 0 ? (
        <PermissionsField
          onChange={setSelected}
          permissions={permissions.data}
          selected={selected}
        />
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <Button
          disabled={createApiKey.isPending}
          onClick={close}
          type="button"
          variant="secondary"
        >
          Cancel
        </Button>
        <LoadingButton
          ref={submitRef}
          onAction={async () => {
            if (!nameRef.current?.commit()) throw new AsyncActionAbortError();
            const secret = await createApiKey.mutateAsync({
              name: name.trim(),
              permissions: [...selected],
              expiresAt: expiresAtFor(expiration) ?? null,
            });
            onCreated(secret);
          }}
          pendingLabel="Creating…"
          successLabel="Created"
          type="submit"
        >
          Create API key
        </LoadingButton>
      </div>
    </form>
  );
}

function matchesPermission(permission: ApiKeyPermission, filter: string) {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return [permission.name, permission.slug, permission.description ?? ""].some(
    (value) => value.toLowerCase().includes(needle),
  );
}

function PermissionsField({
  permissions,
  selected,
  onChange,
}: {
  permissions: ApiKeyPermission[];
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}) {
  const [filter, setFilter] = useState("");
  const visible = useMemo(
    () =>
      permissions.filter((permission) => matchesPermission(permission, filter)),
    [permissions, filter],
  );
  const checkedIndices = useMemo(
    () =>
      new Set(
        visible.flatMap((permission, index) =>
          selected.has(permission.slug) ? [index] : [],
        ),
      ),
    [visible, selected],
  );
  const allSelected = selected.size === permissions.length;

  const toggle = (slug: string) => {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span
          className="text-body text-foreground"
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          Permissions
        </span>
        <span className="text-caption text-muted-foreground">
          Only enable the minimum permissions required for your use case.
        </span>
      </div>
      <SettingsSearchField
        label="Search permissions"
        onChange={setFilter}
        placeholder="Search"
        value={filter}
      />
      {visible.length > 0 ? (
        <>
          <ScrollArea
            className="max-h-[calc(50vh-150px)]"
            viewportClassName="scroll-fade"
          >
            <CheckboxGroup checkedIndices={checkedIndices}>
              {visible.map((permission, index) => (
                <CheckboxItem
                  checked={selected.has(permission.slug)}
                  index={index}
                  key={permission.slug}
                  label={permission.name}
                  onToggle={() => toggle(permission.slug)}
                  title={permission.description ?? undefined}
                />
              ))}
            </CheckboxGroup>
          </ScrollArea>
          <div className="flex items-center gap-2 text-caption text-muted-foreground">
            <span>
              {selected.size === 0
                ? "No permissions selected"
                : selected.size === 1
                  ? "1 permission selected"
                  : `${selected.size} permissions selected`}
            </span>
            <Button
              onClick={() =>
                onChange(
                  allSelected
                    ? new Set()
                    : new Set(permissions.map((permission) => permission.slug)),
                )
              }
              size="compact"
              type="button"
              variant="ghost"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Search className="size-5 text-muted-foreground" />
          <span
            className="text-body text-foreground"
            style={{ fontVariationSettings: fontWeights.semibold }}
          >
            No permissions match your search
          </span>
          <Button
            onClick={() => setFilter("")}
            size="compact"
            type="button"
            variant="secondary"
          >
            Clear search
          </Button>
        </div>
      )}
    </div>
  );
}

function SaveApiKey({ secret, close }: { secret: string; close: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Banner status="info">
        <BannerDescription>
          You won&apos;t be able to access the key again. Please copy it now.
        </BannerDescription>
      </Banner>
      <InputCopy value={secret} />
      <div className="mt-2 flex justify-end">
        <Button
          onClick={() => {
            void navigator.clipboard
              .writeText(secret)
              .catch(() => undefined)
              .finally(close);
          }}
          type="button"
        >
          Copy and close
        </Button>
      </div>
    </div>
  );
}
