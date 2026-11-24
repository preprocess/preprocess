"use client";

// Port of the WorkOS directory-sync widget.

import { Loader } from "@preprocess/ui/lib/icons";

import { useWorkOsQuery, workOsKey, type Sdk } from "../workos-client-api/sdk";
import type { DirectoryFieldsFragment } from "../workos-client-api/vendor/generated";
import { AdminPortalButton } from "./admin-portal-button";
import {
  formatRelative,
  SettingsError,
  SettingsReveal,
  SettingsRow,
  SettingsRows,
  SettingsRowSkeleton,
  SettingsStatus,
  SkeletonTile,
} from "./kit";
import {
  SettingsProviderIcon,
  directoryProviderSlug,
  directoryTypeName,
} from "./settings-provider-mark";
import { SettingsNote } from "./sso-panel";

const DIRECTORY_STATES = [
  "requires_type",
  "linked",
  "validating",
  "invalid_credentials",
  "unlinked",
  "deleting",
] as const;
type DirectoryState = (typeof DIRECTORY_STATES)[number];

function isDirectoryState(state: string): state is DirectoryState {
  return (DIRECTORY_STATES as readonly string[]).includes(state);
}

const PAGE_SIZE = 100;

// Directories awaiting a type or mid-deletion aren't usable by the
// organization; like the widget, treat them as not set up.
async function listDirectories(sdk: Sdk) {
  const directories: DirectoryFieldsFragment[] = [];
  let after: string | null = null;
  do {
    const { directoryConnections } = await sdk.ListDirectoryConnections({
      after,
      limit: PAGE_SIZE,
    });
    directories.push(...directoryConnections.data);
    after = directoryConnections.listMetadata.after ?? null;
  } while (after !== null);
  return directories.filter(
    (directory) =>
      isDirectoryState(directory.state) &&
      directory.state !== "requires_type" &&
      directory.state !== "deleting",
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function statusBadge(state: DirectoryState) {
  switch (state) {
    case "requires_type":
    case "invalid_credentials":
      return <SettingsStatus state="error">Requires action</SettingsStatus>;
    case "linked":
      return <SettingsStatus state="success">Connected</SettingsStatus>;
    default:
      return null;
  }
}

function progressMessage(state: DirectoryState) {
  switch (state) {
    case "unlinked":
      return "Setup in progress...";
    case "validating":
      return "Waiting for users and groups...";
    case "deleting":
      return "Deleting directory...";
    default:
      return null;
  }
}

function errorNote(state: DirectoryState) {
  switch (state) {
    case "invalid_credentials":
      return "Your directory credentials are invalid or have expired. Please re-authenticate to resume syncing.";
    case "requires_type":
      return "Your directory requires additional configuration. Please complete setup to begin syncing.";
    default:
      return null;
  }
}

function DirectoryRow({ directory }: { directory: DirectoryFieldsFragment }) {
  const state = directory.state as DirectoryState;
  const showCounts =
    state === "linked" ||
    state === "invalid_credentials" ||
    state === "deleting";
  const counts = showCounts
    ? [
        plural(directory.metadata.users.active, "user", "users"),
        plural(directory.metadata.groups, "group", "groups"),
        directory.lastSyncRunAt
          ? `Last sync ${formatRelative(directory.lastSyncRunAt)}`
          : null,
      ]
        .filter(Boolean)
        .join(" ∙ ")
    : undefined;
  const progress = progressMessage(state);
  const note = errorNote(state);

  return (
    <div>
      <SettingsRow
        description={counts}
        label={directoryTypeName(directory.type)}
        leading={
          <SettingsProviderIcon
            slug={directoryProviderSlug(directory.type) ?? "workos"}
          />
        }
      >
        {statusBadge(state)}
        {progress ? (
          <span className="flex items-center gap-2 text-caption text-muted-foreground">
            <Loader className="size-4 animate-spin" />
            {progress}
          </span>
        ) : null}
        {state !== "deleting" ? (
          <AdminPortalButton intent="Dsync">
            {state === "unlinked" ? "Continue setup" : "Manage"}
          </AdminPortalButton>
        ) : null}
      </SettingsRow>
      {note ? <SettingsNote>{note}</SettingsNote> : null}
    </div>
  );
}

function DirectorySyncSkeleton() {
  return (
    <SettingsRows>
      <SettingsRowSkeleton
        action={84}
        description={180}
        label={120}
        leading={<SkeletonTile />}
      />
    </SettingsRows>
  );
}

export function DirectorySyncPanel() {
  const query = useWorkOsQuery({
    queryKey: workOsKey("ListDirectoryConnections"),
    queryFn: listDirectories,
  });

  if (query.isError) return <SettingsError error={query.error} />;

  return (
    <SettingsReveal data={query.data} skeleton={<DirectorySyncSkeleton />}>
      {(data) => {
        if (data.length === 0) {
          return (
            <SettingsRows>
              <SettingsRow label="You haven't set up a directory yet.">
                <AdminPortalButton intent="Dsync">
                  Set up directory
                </AdminPortalButton>
              </SettingsRow>
            </SettingsRows>
          );
        }

        return (
          <SettingsRows>
            {data.map((directory) => (
              <DirectoryRow directory={directory} key={directory.id} />
            ))}
          </SettingsRows>
        );
      }}
    </SettingsReveal>
  );
}
