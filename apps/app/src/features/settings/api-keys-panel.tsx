"use client";

// API keys, ported from the WorkOS api-keys (organization) and user-api-keys
// widgets (@workos-inc/widgets) onto Fluid: search by name, a table of keys,
// create, view details, edit expiration, and revoke.

import { Button } from "@preprocess/ui/components/button";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@preprocess/ui/components/table";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { Search } from "@preprocess/ui/lib/icons";
import { useEffect, useState } from "react";

import {
  apiKeyCreatedBy,
  formatExpiresAt,
  useApiKeyPermissions,
  useApiKeys,
  useRevokeApiKey,
  type ApiKey,
  type ApiKeyListParams,
  type ApiKeyScope,
} from "./api-keys/data";
import { CreateApiKeyDialog } from "./api-keys/create-dialog";
import { EditExpirationDialog } from "./api-keys/expiration";
import {
  ActionErrorBanner,
  ApiKeyDetailsList,
  LastUsed,
  SecretValue,
} from "./api-keys/parts";
import {
  SettingsCard,
  SettingsDialogShell,
  SettingsEmpty,
  SettingsError,
  SettingsReveal,
  SettingsRowMenu,
  SettingsSearchField,
  SkeletonButton,
  SkeletonField,
  SkeletonLine,
} from "./kit";

const SEARCH_DEBOUNCE_MS = 300;

// First load: search and Create need the list to work, so they are skeletons;
// the column headers are static and render as themselves.
function ApiKeysSkeleton({ scope }: { scope: ApiKeyScope }) {
  const showOwner = scope === "user";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <SkeletonField className="min-w-48 flex-1" />
        <SkeletonButton width={128} />
      </div>
      <SettingsCard table>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Secret key</TableHead>
              {showOwner ? <TableHead>Created by</TableHead> : null}
              <TableHead>Last used</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 3 }, (_, index) => (
              <TableRow key={index}>
                <TableCell>
                  <SkeletonLine width={120} />
                </TableCell>
                <TableCell>
                  <SkeletonLine width={96} />
                </TableCell>
                {showOwner ? (
                  <TableCell>
                    <SkeletonLine width={110} />
                  </TableCell>
                ) : null}
                <TableCell>
                  <SkeletonLine width={72} />
                </TableCell>
                <TableCell>
                  <SkeletonLine width={64} />
                </TableCell>
                <TableCell>
                  <SkeletonButton width={28} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SettingsCard>
    </div>
  );
}

export function ApiKeysPanel({ scope }: { scope: ApiKeyScope }) {
  const [searchValue, setSearchValue] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<Pick<ApiKeyListParams, "after" | "before">>(
    {},
  );
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchValue.trim());
      setPage({});
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchValue]);

  const keys = useApiKeys(scope, { ...page, search });

  const createButton = (
    <Button onClick={() => setCreateOpen(true)} type="button">
      Create API key
    </Button>
  );

  const renderKeys = (list: NonNullable<typeof keys.data>) => {
    if (list.data.length === 0 && !search) {
      return (
        <SettingsEmpty
          action={createButton}
          description="Generate an API key to authenticate and interact with our API."
          title="No API keys yet"
        />
      );
    }
    const { after, before } = list.listMetadata;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <SettingsSearchField
            className="min-w-48 flex-1"
            label="Search API keys"
            name={`${scope}-api-keys-search`}
            onChange={setSearchValue}
            placeholder="Search by name"
            value={searchValue}
          />
          {createButton}
        </div>
        {list.data.length === 0 ? (
          <NoMatches
            onClear={() => {
              setSearchValue("");
              setSearch("");
              setPage({});
            }}
          />
        ) : (
          <ApiKeysTable keys={list.data} scope={scope} />
        )}
        {after || before ? (
          <div className="flex justify-end gap-2">
            <Button
              disabled={!before}
              onClick={() => setPage({ before })}
              size="compact"
              type="button"
              variant="secondary"
            >
              Previous
            </Button>
            <Button
              disabled={!after}
              onClick={() => setPage({ after })}
              size="compact"
              type="button"
              variant="secondary"
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div data-testid={`${scope}-api-keys-panel`}>
      {keys.isError ? (
        <SettingsError error={keys.error} />
      ) : (
        <SettingsReveal
          data={keys.data}
          skeleton={<ApiKeysSkeleton scope={scope} />}
        >
          {renderKeys}
        </SettingsReveal>
      )}
      <CreateApiKeyDialog
        onOpenChange={setCreateOpen}
        open={createOpen}
        scope={scope}
      />
    </div>
  );
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <SettingsCard className="flex flex-col items-center gap-4 px-6 py-10 text-center">
      <Search className="size-8 text-muted-foreground" />
      <p
        className="text-subtitle text-foreground"
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        No API keys match your search
      </p>
      <Button onClick={onClear} type="button" variant="secondary">
        Clear search
      </Button>
    </SettingsCard>
  );
}

function ApiKeysTable({ keys, scope }: { keys: ApiKey[]; scope: ApiKeyScope }) {
  const showOwner = scope === "user";
  return (
    <SettingsCard table>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Secret key</TableHead>
            {showOwner ? <TableHead>Created by</TableHead> : null}
            <TableHead>Last used</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((apiKey, index) => (
            <ApiKeyRow
              apiKey={apiKey}
              index={index}
              key={apiKey.id}
              scope={scope}
              showOwner={showOwner}
            />
          ))}
        </TableBody>
      </Table>
    </SettingsCard>
  );
}

function ApiKeyRow({
  apiKey,
  index,
  scope,
  showOwner,
}: {
  apiKey: ApiKey;
  index: number;
  scope: ApiKeyScope;
  showOwner: boolean;
}) {
  const [dialog, setDialog] = useState<
    "details" | "expiration" | "revoke" | null
  >(null);
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <>
      <TableRow index={index}>
        <TableCell className="text-foreground">{apiKey.name}</TableCell>
        <TableCell>
          <SecretValue value={apiKey.obfuscatedValue} />
        </TableCell>
        {showOwner ? <TableCell>{apiKeyCreatedBy(apiKey)}</TableCell> : null}
        <TableCell>
          <LastUsed apiKey={apiKey} />
        </TableCell>
        <TableCell>{formatExpiresAt(apiKey.expiresAt)}</TableCell>
        <TableCell className="text-right">
          <SettingsRowMenu
            actions={[
              { label: "View details", onSelect: () => setDialog("details") },
              {
                label: "Edit expiration",
                onSelect: () => setDialog("expiration"),
              },
              { label: "Revoke key", onSelect: () => setDialog("revoke") },
            ]}
            label="API key actions"
          />
        </TableCell>
      </TableRow>
      <ApiKeyDetailsDialog
        apiKey={apiKey}
        onOpenChange={close}
        open={dialog === "details"}
        scope={scope}
      />
      <EditExpirationDialog
        apiKey={apiKey}
        onOpenChange={close}
        open={dialog === "expiration"}
        scope={scope}
      />
      <RevokeApiKeyDialog
        apiKey={apiKey}
        onOpenChange={close}
        open={dialog === "revoke"}
        scope={scope}
      />
    </>
  );
}

function ApiKeyDetailsDialog({
  apiKey,
  scope,
  open,
  onOpenChange,
}: {
  apiKey: ApiKey;
  scope: ApiKeyScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const permissions = useApiKeyPermissions(scope);
  const bySlug = new Map(
    (permissions.data ?? []).map((permission) => [permission.slug, permission]),
  );
  const granted = apiKey.permissions.map(
    (slug) => bySlug.get(slug) ?? { slug, name: slug, description: null },
  );

  return (
    <SettingsDialogShell
      footer={
        <Button
          onClick={() => onOpenChange(false)}
          type="button"
          variant="secondary"
        >
          Close
        </Button>
      }
      onOpenChange={onOpenChange}
      open={open}
      size="lg"
      title="API key details"
    >
      <div className="flex flex-col gap-5">
        <ApiKeyDetailsList apiKey={apiKey} />
        {granted.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span
              className="text-body text-foreground"
              style={{ fontVariationSettings: fontWeights.semibold }}
            >
              Permissions
            </span>
            <ScrollArea
              className="max-h-[calc(50vh-150px)]"
              viewportClassName="scroll-fade"
            >
              {granted.map((permission) => (
                <div
                  className="flex flex-col border-b border-border/60 py-3 last:border-b-0"
                  key={permission.slug}
                >
                  <span
                    className="text-body text-foreground"
                    style={{ fontVariationSettings: fontWeights.semibold }}
                  >
                    {permission.name}
                  </span>
                  {permission.description ? (
                    <span className="text-body text-muted-foreground">
                      {permission.description}
                    </span>
                  ) : null}
                </div>
              ))}
            </ScrollArea>
          </div>
        ) : null}
      </div>
    </SettingsDialogShell>
  );
}

function RevokeApiKeyDialog({
  apiKey,
  scope,
  open,
  onOpenChange,
}: {
  apiKey: ApiKey;
  scope: ApiKeyScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const revoke = useRevokeApiKey(scope);

  const { reset } = revoke;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  return (
    <SettingsDialogShell
      description={
        <>
          This API key will be immediately disabled. API request made using this
          key will be rejected, which could cause any systems still depending on
          it to break.{" "}
          <strong style={{ fontVariationSettings: fontWeights.semibold }}>
            This action cannot be undone.
          </strong>
        </>
      }
      footer={
        <>
          <Button
            disabled={revoke.isPending}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <LoadingButton
            onAction={() => revoke.mutateAsync(apiKey.id)}
            onStatusChange={(status) => {
              if (status === "success") {
                window.setTimeout(() => onOpenChange(false), 600);
              }
            }}
            pendingLabel="Revoking…"
            successLabel="Revoked"
          >
            Revoke key
          </LoadingButton>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      size="lg"
      title="Revoke API key?"
    >
      <div className="flex flex-col gap-4">
        {revoke.error ? (
          <ActionErrorBanner>
            An error occurred while revoking the API key.
          </ActionErrorBanner>
        ) : null}
        <ApiKeyDetailsList apiKey={apiKey} />
      </div>
    </SettingsDialogShell>
  );
}
