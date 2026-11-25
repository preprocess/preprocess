"use client";

import { fontWeights } from "@preprocess/ui/lib/font-weight";
import type { ReactNode } from "react";

/** Settings sections stacked on one page. */
export function SettingsStacked({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-10">{children}</div>;
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
