"use client";

// Port of the WorkOS admin-portal-audit-log-streaming widget.

import { useWorkOsQuery, workOsKey } from "../workos-client-api/sdk";
import type { AuditLogStreamState } from "../workos-client-api/vendor/generated";
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
  auditLogDestination,
} from "./settings-provider-mark";
import { SettingsNote } from "./sso-panel";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Event ids are ULIDs; their first 10 characters encode the timestamp. */
function decodeUlidTimestamp(ulid: string): Date | null {
  if (ulid.length < 10) return null;
  let timestamp = 0;
  for (let index = 0; index < 10; index++) {
    const value = CROCKFORD_BASE32.indexOf(ulid.charAt(index).toUpperCase());
    if (value === -1) return null;
    timestamp = timestamp * 32 + value;
  }
  return new Date(timestamp);
}

type StreamStatus = "Inactive" | "Active" | "Error";

function streamStatus(state: AuditLogStreamState): StreamStatus {
  switch (state) {
    case "Active":
      return "Active";
    case "Error":
    case "Invalid":
      return "Error";
    default:
      return "Inactive";
  }
}

function statusBadge(status: StreamStatus) {
  switch (status) {
    case "Inactive":
      return <SettingsStatus state="waiting">Setup in progress</SettingsStatus>;
    case "Active":
      return <SettingsStatus state="success">Streaming</SettingsStatus>;
    case "Error":
      return <SettingsStatus state="error">Not streaming</SettingsStatus>;
  }
}

function AuditLogStreamingSkeleton() {
  return (
    <SettingsRows>
      <SettingsRowSkeleton
        action={84}
        description={160}
        label={110}
        leading={<SkeletonTile />}
      />
    </SettingsRows>
  );
}

export function AuditLogStreamingPanel() {
  const query = useWorkOsQuery({
    queryKey: workOsKey("AuditLogStream"),
    queryFn: (sdk) => sdk.AuditLogStream(),
    select: (data) => data.auditLogStream ?? null,
  });

  if (query.isError) return <SettingsError error={query.error} />;

  return (
    <SettingsReveal data={query.data} skeleton={<AuditLogStreamingSkeleton />}>
      {(data) => {
        const stream = data;
        if (!stream) {
          return (
            <SettingsRows>
              <SettingsRow label="You haven't set up Log Streams yet.">
                <AdminPortalButton intent="LogStreams">
                  Set up Log Streams
                </AdminPortalButton>
              </SettingsRow>
            </SettingsRows>
          );
        }

        const status = streamStatus(stream.state);
        const destination = auditLogDestination(stream.type);
        const lastSyncedAt =
          status !== "Inactive" && stream.lastSyncedEventId
            ? decodeUlidTimestamp(stream.lastSyncedEventId)
            : null;

        return (
          <SettingsRows>
            <SettingsRow
              description={
                lastSyncedAt
                  ? `Last sync ${formatRelative(lastSyncedAt)}`
                  : undefined
              }
              label={destination.name}
              leading={<SettingsProviderIcon slug={destination.slug} />}
            >
              {statusBadge(status)}
              <AdminPortalButton intent="LogStreams">
                {status === "Inactive" ? "Continue setup" : "Manage"}
              </AdminPortalButton>
            </SettingsRow>
            {status === "Error" ? (
              <SettingsNote>
                The credentials provided are incorrect or missing. Please review
                and update your log stream configuration.
              </SettingsNote>
            ) : null}
          </SettingsRows>
        );
      }}
    </SettingsReveal>
  );
}
