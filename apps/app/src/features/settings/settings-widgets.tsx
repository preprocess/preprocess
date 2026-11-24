"use client";

import {
  TabsSubtle,
  TabsSubtleItem,
} from "@preprocess/ui/components/tabs-subtle";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import type { ReactNode } from "react";

export const ORGANIZATION_SETTINGS_TABS = [
  { action: "general", slug: "", label: "General" },
  { action: "members", slug: "members", label: "Members" },
  { action: "groups", slug: "groups", label: "Groups" },
  { action: "audit-logs", slug: "audit-logs", label: "Audit log" },
] as const;

/** Settings sections stacked on one page. */
export function SettingsStacked({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-10">{children}</div>;
}

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

export function SettingsPageHeader({
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
