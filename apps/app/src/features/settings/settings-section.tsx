"use client";

import { Outlet, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { currentSettingsPage, SettingsSwitcher } from "./settings-nav";
import { SettingsChrome, SettingsPageHeader } from "./settings-widgets";

// A settings page: the switcher on narrow panels, the page's title, then the
// page. The section sidebar beside it lives in the /settings layout.
function SettingsPage({ group }: { group: string }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const page = currentSettingsPage(pathname);
  return (
    <SettingsChrome>
      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-4">
          <SettingsSwitcher />
          <SettingsPageHeader
            detail={
              <p className="text-caption text-muted-foreground">
                {page?.group ?? group}
              </p>
            }
            title={page?.label ?? group}
          />
        </div>
        <Outlet />
      </div>
    </SettingsChrome>
  );
}

export function AccountSettingsSection(): ReactNode {
  return <SettingsPage group="Account" />;
}

export function OrganizationSettingsSection(): ReactNode {
  return <SettingsPage group="Organization" />;
}
