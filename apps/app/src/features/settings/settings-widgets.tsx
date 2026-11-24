"use client";

import {
  TabsSubtle,
  TabsSubtleItem,
  TabsSubtlePanel,
} from "@preprocess/ui/components/tabs-subtle";
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

export const ACCOUNT_SETTINGS_TABS = [
  { action: "profile", slug: "", label: "Profile" },
  {
    action: "security",
    slug: "security",
    label: "Security",
  },
  { action: "sessions", slug: "sessions", label: "Sessions" },
  { action: "api-keys", slug: "api-keys", label: "API keys" },
] as const satisfies readonly {
  action: AccountSettingsAction;
  slug: string;
  label: string;
}[];

export const ORGANIZATION_SETTINGS_TABS = [
  { action: "general", slug: "", label: "General" },
  { action: "members", slug: "members", label: "Members" },
  { action: "groups", slug: "groups", label: "Groups" },
  {
    action: "authentication",
    slug: "authentication",
    label: "Authentication",
  },
  {
    action: "billing",
    slug: "billing",
    label: "Billing",
  },
] as const satisfies readonly {
  /** Groups is ours, on seed data, not a WorkOS widget. */
  action: OrganizationSettingsAction | "groups";
  slug: string;
  label: string;
}[];

export function settingsTabIndexFromPath(
  pathname: string,
  basePath: string,
  tabs: readonly { slug: string }[],
): number {
  const path = pathname.replace(/\/+$/, "");
  const base = basePath.replace(/\/+$/, "");
  if (path === base) return 0;
  const rest = path.startsWith(`${base}/`) ? path.slice(base.length + 1) : "";
  const index = tabs.findIndex((tab) => tab.slug === rest);
  return index === -1 ? 0 : index;
}

export function settingsTabHref(basePath: string, slug: string): string {
  const base = basePath.replace(/\/+$/, "");
  return slug ? `${base}/${slug}` : `${base}/`;
}

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

function SettingsPageHeader({
  title,
  detail,
  tabs,
}: {
  title: string;
  detail?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1
          className="text-title tracking-[-0.02em] text-foreground"
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {title}
        </h1>
        {detail}
      </div>
      {tabs ? (
        // -ml-3 cancels the tab items' padding so the first label lines up
        // with the title.
        <div className="-ml-3 flex h-9 shrink-0 items-stretch">{tabs}</div>
      ) : null}
    </div>
  );
}

export function SettingsSectionTabs({
  title,
  detail,
  idPrefix,
  labels,
  selectedIndex,
  onSelect,
}: {
  title: string;
  detail?: ReactNode;
  idPrefix: string;
  labels: readonly string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <SettingsPageHeader
      title={title}
      detail={detail}
      tabs={
        <TabsSubtle
          aria-label={idPrefix}
          className="gap-1"
          idPrefix={idPrefix}
          onSelect={onSelect}
          selectedIndex={selectedIndex}
        >
          {labels.map((label, index) => (
            <TabsSubtleItem index={index} key={label} label={label} />
          ))}
        </TabsSubtle>
      }
    />
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

export function AccountSettingsWidgets({
  action = "profile",
  onActionChange,
}: {
  action?: AccountSettingsAction;
  onActionChange?: (action: AccountSettingsAction) => void;
}) {
  const selectedIndex = Math.max(
    0,
    ACCOUNT_SETTINGS_TABS.findIndex((tab) => tab.action === action),
  );

  return (
    <div
      className="flex flex-col gap-12"
      data-testid="account-settings-widgets"
    >
      <SettingsSectionTabs
        title="Account settings"
        idPrefix="account-settings"
        labels={ACCOUNT_SETTINGS_TABS.map((tab) => tab.label)}
        onSelect={(index) => {
          const next = ACCOUNT_SETTINGS_TABS[index];
          if (next) onActionChange?.(next.action);
        }}
        selectedIndex={selectedIndex}
      />
      <TabsSubtlePanel
        idPrefix="account-settings"
        index={selectedIndex}
        selectedIndex={selectedIndex}
      >
        <AccountSettingsAction action={action} />
      </TabsSubtlePanel>
    </div>
  );
}

export function OrganizationSettingsWidgets({
  action = "general",
  onActionChange,
}: {
  action?: OrganizationSettingsAction;
  onActionChange?: (action: OrganizationSettingsAction) => void;
}) {
  const selectedIndex = Math.max(
    0,
    ORGANIZATION_SETTINGS_TABS.findIndex((tab) => tab.action === action),
  );

  return (
    <div
      className="flex flex-col gap-12"
      data-testid="organization-settings-widgets"
    >
      <SettingsSectionTabs
        title="Organization Settings"
        idPrefix="organization-settings"
        labels={ORGANIZATION_SETTINGS_TABS.map((tab) => tab.label)}
        onSelect={(index) => {
          const next = ORGANIZATION_SETTINGS_TABS[index];
          // Groups has its own routes; this widget view has no panel for it.
          if (next && next.action !== "groups") onActionChange?.(next.action);
        }}
        selectedIndex={selectedIndex}
      />
      <TabsSubtlePanel
        idPrefix="organization-settings"
        index={selectedIndex}
        selectedIndex={selectedIndex}
      >
        <OrganizationSettingsAction action={action} />
      </TabsSubtlePanel>
    </div>
  );
}
