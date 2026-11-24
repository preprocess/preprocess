"use client";

// Port of the WorkOS admin-portal-sso-connection widget.

import { InfoIcon } from "@preprocess/ui/lib/icons";
import type { ReactNode } from "react";

import { useWorkOsQuery, workOsKey } from "../workos-client-api/sdk";
import type { ConnectionFieldsFragment } from "../workos-client-api/vendor/generated";
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
  ssoProviderName,
  ssoProviderSlug,
} from "./settings-provider-mark";

type ConnectionStatus =
  | { status: "Active" }
  | { status: "Inactive" }
  | { status: "Expiring"; expiryDate: Date | null }
  | { status: "Expired"; expiryDate: Date | null };

const DAY = 24 * 60 * 60 * 1000;

/** The widget's getConnectionState: SAML certificates drive Expiring/Expired. */
export function ssoConnectionStatus(
  connection: ConnectionFieldsFragment,
  now = Date.now(),
): ConnectionStatus {
  if (connection.state === "Inactive") return { status: "Inactive" };
  if (connection.providerTag !== "Saml") return { status: "Active" };

  const expired = connection.latestExpiredCertificate;
  if (expired) {
    return {
      status: "Expired",
      expiryDate: expired.notAfter ? new Date(expired.notAfter) : null,
    };
  }

  const expiryTime = connection.latestExpiringCertificate?.notAfter;
  if (!expiryTime) return { status: "Active" };
  const expiryDate = new Date(expiryTime);
  const untilExpiry = expiryDate.getTime() - now;
  // The query may not have moved a just-lapsed certificate to
  // latestExpiredCertificate yet.
  if (untilExpiry < 0) return { status: "Expired", expiryDate };
  if (untilExpiry / DAY <= 30) return { status: "Expiring", expiryDate };
  return { status: "Active" };
}

function longDate(date: Date) {
  return date.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function expiryNote(state: ConnectionStatus) {
  if (state.status === "Expired") {
    return state.expiryDate
      ? `The SAML response signing certificate expired on ${longDate(state.expiryDate)}. Users won't be able to sign-in to the application until the certificate is renewed.`
      : "The SAML response signing certificate has expired. Users won't be able to sign-in to the application until the certificate is renewed.";
  }
  if (state.status === "Expiring") {
    return state.expiryDate
      ? `The SAML response signing certificate will expire on ${longDate(state.expiryDate)}. When expired, users won't be able to sign-in.`
      : "The SAML response signing certificate is expiring soon. When expired, users won't be able to sign-in.";
  }
  return null;
}

function statusBadge(state: ConnectionStatus) {
  switch (state.status) {
    case "Inactive":
      return <SettingsStatus state="waiting">Setup in progress</SettingsStatus>;
    case "Expired":
      return <SettingsStatus state="error">Requires action</SettingsStatus>;
    case "Active":
    case "Expiring":
      return <SettingsStatus state="success">Connected</SettingsStatus>;
  }
}

/** An explanatory line under a row: info glyph and muted text. */
export function SettingsNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-5 py-3 text-caption text-muted-foreground">
      <InfoIcon className="mt-0.5 size-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function SsoSkeleton() {
  return (
    <SettingsRows>
      <SettingsRowSkeleton
        action={84}
        description={160}
        label={120}
        leading={<SkeletonTile />}
      />
    </SettingsRows>
  );
}

export function SsoPanel() {
  const query = useWorkOsQuery({
    queryKey: workOsKey("ListSsoConnections"),
    queryFn: (sdk) => sdk.ListSsoConnections(),
    select: (data) => data.ssoConnections,
  });

  if (query.isError) return <SettingsError error={query.error} />;

  return (
    <SettingsReveal data={query.data} skeleton={<SsoSkeleton />}>
      {(data) => {
        const connections = data;
        if (connections.length === 0) {
          return (
            <SettingsRows>
              <SettingsRow label="You haven't set up Single Sign-On yet.">
                <AdminPortalButton intent="Sso">Set up SSO</AdminPortalButton>
              </SettingsRow>
            </SettingsRows>
          );
        }

        const now = Date.now();
        return (
          <SettingsRows>
            {connections.map((connection) => {
              const state = ssoConnectionStatus(connection, now);
              const note = expiryNote(state);
              const lastSession =
                state.status !== "Inactive" && connection.lastSession
                  ? `Last session ${formatRelative(connection.lastSession.createdAt)}`
                  : undefined;
              return (
                <div key={connection.id}>
                  <SettingsRow
                    description={lastSession}
                    label={ssoProviderName(connection.type)}
                    leading={
                      <SettingsProviderIcon
                        slug={ssoProviderSlug(connection.type)}
                      />
                    }
                  >
                    {statusBadge(state)}
                    <AdminPortalButton intent="Sso">
                      {state.status === "Inactive"
                        ? "Continue setup"
                        : "Manage"}
                    </AdminPortalButton>
                  </SettingsRow>
                  {note ? <SettingsNote>{note}</SettingsNote> : null}
                </div>
              );
            })}
          </SettingsRows>
        );
      }}
    </SettingsReveal>
  );
}
