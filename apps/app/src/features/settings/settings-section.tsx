"use client";

import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import {
  ORGANIZATION_SETTINGS_TABS,
  SettingsPageHeader,
  SettingsChrome,
  SettingsSectionTabs,
  settingsTabIndexFromPath,
} from "./settings-widgets";

function SettingsRoutedSection({
  title,
  detail,
  basePath,
  idPrefix,
  tabs,
  onSelect,
}: {
  title: string;
  detail?: ReactNode;
  basePath: "/settings/organization";
  idPrefix: string;
  tabs: readonly { slug: string; label: string }[];
  onSelect: (index: number) => void;
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const selectedIndex = settingsTabIndexFromPath(pathname, basePath, tabs);

  return (
    <SettingsChrome>
      <div className="flex flex-col gap-12">
        <SettingsSectionTabs
          title={title}
          detail={detail}
          idPrefix={idPrefix}
          labels={tabs.map((tab) => tab.label)}
          onSelect={onSelect}
          selectedIndex={selectedIndex}
        />
        <Outlet />
      </div>
    </SettingsChrome>
  );
}

export function AccountSettingsSection(): ReactNode {
  return (
    <SettingsChrome>
      <div className="flex flex-col gap-12">
        <SettingsPageHeader title="Account settings" />
        <Outlet />
      </div>
    </SettingsChrome>
  );
}

export function OrganizationSettingsSection(): ReactNode {
  const navigate = useNavigate();

  return (
    <SettingsRoutedSection
      title="Organization Settings"
      basePath="/settings/organization"
      idPrefix="organization-settings"
      onSelect={(index) => {
        const tab = ORGANIZATION_SETTINGS_TABS[index];
        if (!tab) return;
        switch (tab.action) {
          case "general":
            void navigate({ to: "/settings/organization" });
            return;
          case "members":
            void navigate({ to: "/settings/organization/members" });
            return;
          case "groups":
            void navigate({ to: "/settings/organization/groups" });
            return;
          case "audit-logs":
            void navigate({ to: "/settings/organization/audit-logs" });
            return;
          default: {
            const _exhaustive: never = tab;
            return _exhaustive;
          }
        }
      }}
      tabs={ORGANIZATION_SETTINGS_TABS}
    />
  );
}
