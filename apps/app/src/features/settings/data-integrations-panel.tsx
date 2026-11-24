"use client";

// Data integrations ("Pipes"): a port of the WorkOS Pipes and PipesAdmin
// widgets (@workos-inc/widgets, MIT) onto the Client API and the settings
// kit. Members see the organization's shared connections and connect their
// own accounts; administrators (`widgets:pipes:manage`) also manage the
// organization-owned connections.

import {
  useCanManageIntegrations,
  useCurrentOrganizationName,
  useMyIntegrations,
  useOrganizationIntegrations,
  useSharedIntegrations,
} from "./data-integrations/model";
import {
  MemberConnectionsSection,
  SharedConnectionsAdminSection,
  SharedConnectionsSection,
} from "./data-integrations/sections";
import {
  SettingsError,
  SettingsReveal,
  SettingsRows,
  SettingsRowSkeleton,
  SettingsSection,
  SkeletonTile,
} from "./kit";

function DataIntegrationsSkeleton() {
  return (
    <SettingsSection title="Your connections">
      <SettingsRows>
        {[140, 110].map((width) => (
          <SettingsRowSkeleton
            action={84}
            description={200}
            key={width}
            label={width}
            leading={<SkeletonTile />}
          />
        ))}
      </SettingsRows>
    </SettingsSection>
  );
}

export function DataIntegrationsPanel() {
  const canManage = useCanManageIntegrations();
  const organizationName = useCurrentOrganizationName();
  const mine = useMyIntegrations();
  const shared = useSharedIntegrations(!canManage);
  const organization = useOrganizationIntegrations(canManage);

  if (mine.isError) return <SettingsError error={mine.error} />;

  // One reveal for the tab: the shared (or organization) list loads with it.
  const sharedList = canManage ? organization : shared;
  const ready =
    mine.data && (sharedList.data || sharedList.isError)
      ? mine.data
      : undefined;

  return (
    <SettingsReveal data={ready} skeleton={<DataIntegrationsSkeleton />}>
      {(myIntegrations) => (
        <div
          className="flex flex-col gap-8"
          data-testid="data-integrations-panel"
        >
          {canManage ? (
            <SharedConnectionsAdminSection
              integrations={organization.data ?? []}
              organizationName={organizationName}
            />
          ) : (
            <SharedConnectionsSection
              integrations={shared.data ?? []}
              organizationName={organizationName}
            />
          )}
          <MemberConnectionsSection integrations={myIntegrations} />
        </div>
      )}
    </SettingsReveal>
  );
}
