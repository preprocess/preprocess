"use client";

import { fontWeights } from "@preprocess/ui/lib/font-weight";
import type { ReactNode } from "react";

import { useOptionalClientApiSession } from "../workos-client-api/client-api-session";
import { ApiKeysPanel } from "./api-keys-panel";
import { AuditLogStreamingPanel } from "./audit-log-streaming-panel";
import { BillingPanel } from "./billing-panel";
import { ByokPanel } from "./byok-panel";
import { CustomDomainPanel } from "./custom-domain-panel";
import { DirectorySyncPanel } from "./directory-sync-panel";
import { DomainsPanel } from "./domains-panel";
import { DataIntegrationsPanel } from "./data-integrations-panel";
import { SettingsPanelMessage, SettingsSection } from "./kit";
import { MembersPanel } from "./members-panel";
import {
  DeleteOrganizationPanel,
  OrganizationDetailsPanel,
  OrganizationPanel,
} from "./organization-panel";
import { ProfilePanel } from "./profile-panel";
import { SecurityPanel } from "./security-panel";
import { SessionsPanel } from "./sessions-panel";
import { SsoPanel } from "./sso-panel";

export type AccountSettingsAction =
  "profile" | "security" | "sessions" | "api-keys";
export type OrganizationSettingsAction =
  "general" | "members" | "authentication" | "billing";
/** Settings that live under Developers in the sidebar, not in a tab. */
export type DeveloperSettingsAction = "api-keys" | "integrations";

export function SettingsChrome({ children }: { children: ReactNode }) {
  return (
    <div
      className="mx-auto w-full max-w-3xl px-6 py-8"
      data-testid="settings-chrome"
    >
      {children}
    </div>
  );
}

export function SettingsPageHeader({
  title,
  detail,
}: {
  title: string;
  detail?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h1
        className="text-title tracking-[-0.02em] text-foreground"
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {title}
      </h1>
      {detail}
    </div>
  );
}

function SettingsStacked({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-10">{children}</div>;
}

// Panels render while the session loads: their queries wait for it and each
// panel shows its own layout-matched skeleton, so there is one skeleton and
// one reveal per panel instead of a generic placeholder first.
function SettingsActionPanel({ children }: { children: () => ReactNode }) {
  const client = useOptionalClientApiSession();

  if (client && !client.loading && !client.session) {
    return (
      <SettingsPanelMessage>
        {client.error ?? "Sign in to an organization to manage settings."}
      </SettingsPanelMessage>
    );
  }

  return children();
}

function GeneralSettingsLayout({
  customDomain,
  dangerous,
  details,
  organization,
}: {
  customDomain: ReactNode;
  dangerous: ReactNode;
  details: ReactNode;
  organization: ReactNode;
}) {
  return (
    <SettingsStacked>
      <SettingsSection title="Branding">{organization}</SettingsSection>
      <SettingsSection title="Custom domain">{customDomain}</SettingsSection>
      <SettingsSection title="Details">{details}</SettingsSection>
      <SettingsSection title="Dangerous actions">{dangerous}</SettingsSection>
    </SettingsStacked>
  );
}

function AuthenticationSettingsLayout({
  auditLogs,
  directory,
  domains,
  sso,
}: {
  auditLogs: ReactNode;
  directory: ReactNode;
  domains: ReactNode;
  sso: ReactNode;
}) {
  return (
    <SettingsStacked>
      <SettingsSection title="SSO">{sso}</SettingsSection>
      <SettingsSection
        description="Used only to verify email logins and SSO. This does not change your website or email hosting."
        title="Domains"
      >
        {domains}
      </SettingsSection>
      <SettingsSection title="Directory sync">{directory}</SettingsSection>
      <SettingsSection title="Audit log streaming">{auditLogs}</SettingsSection>
    </SettingsStacked>
  );
}

function ApiKeysSettingsLayout({
  apiKeys,
  byok,
}: {
  apiKeys: ReactNode;
  byok: ReactNode;
}) {
  return (
    <SettingsStacked>
      <SettingsSection title="API keys">{apiKeys}</SettingsSection>
      <SettingsSection title="Bring your own key">{byok}</SettingsSection>
    </SettingsStacked>
  );
}

export function AccountSettingsAction({
  action,
}: {
  action: AccountSettingsAction;
}) {
  switch (action) {
    case "profile":
      return (
        <SettingsActionPanel>{() => <ProfilePanel />}</SettingsActionPanel>
      );
    case "security":
      return (
        <SettingsActionPanel>{() => <SecurityPanel />}</SettingsActionPanel>
      );
    case "sessions":
      return (
        <SettingsActionPanel>{() => <SessionsPanel />}</SettingsActionPanel>
      );
    case "api-keys":
      return (
        <SettingsActionPanel>
          {() => <ApiKeysPanel scope="user" />}
        </SettingsActionPanel>
      );
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function OrganizationSettingsAction({
  action,
}: {
  action: OrganizationSettingsAction;
}) {
  switch (action) {
    case "general":
      return (
        <SettingsActionPanel>
          {() => (
            <GeneralSettingsLayout
              customDomain={<CustomDomainPanel />}
              dangerous={<DeleteOrganizationPanel />}
              details={<OrganizationDetailsPanel />}
              organization={<OrganizationPanel />}
            />
          )}
        </SettingsActionPanel>
      );
    case "members":
      return (
        <SettingsActionPanel>{() => <MembersPanel />}</SettingsActionPanel>
      );
    case "authentication":
      return (
        <SettingsActionPanel>
          {() => (
            <AuthenticationSettingsLayout
              auditLogs={<AuditLogStreamingPanel />}
              directory={<DirectorySyncPanel />}
              domains={<DomainsPanel />}
              sso={<SsoPanel />}
            />
          )}
        </SettingsActionPanel>
      );
    case "billing":
      return (
        <SettingsActionPanel>{() => <BillingPanel />}</SettingsActionPanel>
      );
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/** API keys and integrations, shown on their Developers pages. */
export function DeveloperSettingsAction({
  action,
}: {
  action: DeveloperSettingsAction;
}) {
  switch (action) {
    case "api-keys":
      return (
        <SettingsActionPanel>
          {() => (
            <ApiKeysSettingsLayout
              apiKeys={<ApiKeysPanel scope="organization" />}
              byok={<ByokPanel />}
            />
          )}
        </SettingsActionPanel>
      );
    case "integrations":
      return (
        <SettingsActionPanel>
          {() => <DataIntegrationsPanel />}
        </SettingsActionPanel>
      );
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/** A Developers page's settings: title over the panels, settings width. */
export function DeveloperSettingsPage({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingsChrome>
      <div className="flex flex-col gap-12">
        <SettingsPageHeader detail={detail} title={title} />
        {children}
      </div>
    </SettingsChrome>
  );
}
