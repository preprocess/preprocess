"use client";

// Small parts shared by the API keys panel and its dialogs.

import { Banner, BannerDescription } from "@preprocess/ui/components/banner";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { cn } from "@preprocess/ui/lib/utils";
import type { ReactNode } from "react";

import { formatRelative } from "../kit";
import {
  apiKeyCreatedBy,
  formatExpiresAt,
  formatTimestamp,
  type ApiKey,
} from "./data";

/** An action failed: the widgets' one-line callout. */
export function ActionErrorBanner({ children }: { children: ReactNode }) {
  return (
    <Banner role="alert" status="error">
      <BannerDescription>{children}</BannerDescription>
    </Banner>
  );
}

/** The obfuscated secret, set in the monospace code style. */
export function SecretValue({ value }: { value: string }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
      {value}
    </code>
  );
}

export function LastUsed({ apiKey }: { apiKey: ApiKey }) {
  return (
    <span className={cn(!apiKey.lastUsedAt && "text-muted-foreground")}>
      {apiKey.lastUsedAt ? formatRelative(apiKey.lastUsedAt) : "Never"}
    </span>
  );
}

/** The widgets' details card: name, value, last used, expires, created. */
export function ApiKeyDetailsList({ apiKey }: { apiKey: ApiKey }) {
  const rows: [string, ReactNode][] = [
    ["Name", apiKey.name],
    ["Value", <SecretValue key="value" value={apiKey.obfuscatedValue} />],
    ...(apiKey.owner
      ? ([["Created by", apiKeyCreatedBy(apiKey)]] as [string, ReactNode][])
      : []),
    ["Last used", <LastUsed apiKey={apiKey} key="last-used" />],
    ["Expires", formatExpiresAt(apiKey.expiresAt)],
    ["Created", formatTimestamp(apiKey.createdAt)],
  ];
  return (
    <dl className="flex flex-col divide-y divide-border/60">
      {rows.map(([label, value]) => (
        <div className="flex items-center gap-4 py-2.5" key={label}>
          <dt
            className="w-28 shrink-0 text-body text-muted-foreground"
            style={{ fontVariationSettings: fontWeights.normal }}
          >
            {label}
          </dt>
          <dd className="min-w-0 truncate text-body text-foreground">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
