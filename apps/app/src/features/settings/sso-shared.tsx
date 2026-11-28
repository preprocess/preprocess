"use client";

// Parts the Single sign-on and Directory sync pages share (PRE-137, PRE-138):
// a value people copy into their identity provider, the locked-feature row,
// the no-access and loading states, and the dot badges.

import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import { Field, FieldLabel } from "@preprocess/ui/components/field";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { Check, Copy } from "@preprocess/ui/lib/icons";
import { Link } from "@tanstack/react-router";
import { Fragment, useEffect, useState, type ReactNode } from "react";

import { NoAccessArt } from "../../components/empty-art";
import {
  SettingsEmpty,
  SettingsRow,
  SettingsRowSkeleton,
  SettingsRows,
  SettingsSection,
} from "./kit";
import { SettingsStacked } from "./settings-widgets";

/** A value in body text at weight 500 (Protocol, Type). */
export function Strong({ children }: { children: ReactNode }) {
  return (
    <span
      className="truncate text-body text-foreground"
      style={{ fontVariationSettings: fontWeights.medium }}
    >
      {children}
    </span>
  );
}

/** A mono value nobody copies from here; it truncates on narrow panels. */
export function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 truncate font-mono text-caption text-muted-foreground">
      {children}
    </span>
  );
}

/** A row label with a badge beside it. */
export function Labelled({
  label,
  badge,
}: {
  label: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {label}
      {badge}
    </span>
  );
}

export function Dot({
  color,
  children,
}: {
  color: "green" | "amber" | "red" | "gray";
  children: ReactNode;
}) {
  return (
    <Badge color={color} size="compact" variant="dot">
      {children}
    </Badge>
  );
}

/** The caption under a page's last section, such as who can change it. */
export function SettingsNote({ children }: { children: ReactNode }) {
  return <p className="px-5 text-caption text-muted-foreground">{children}</p>;
}

/** Section titles over skeleton rows, one count per section. */
export function SettingsLoadingSections({
  sections,
}: {
  sections: readonly (readonly [title: string, rows: number])[];
}) {
  return (
    <SettingsStacked>
      {sections.map(([title, rows]) => (
        <SettingsSection key={title} title={title}>
          <SettingsRows>
            {Array.from({ length: rows }, (_, i) => (
              <SettingsRowSkeleton description={220} key={i} label={120} />
            ))}
          </SettingsRows>
        </SettingsSection>
      ))}
    </SettingsStacked>
  );
}

export function SettingsNoAccess() {
  return (
    <SettingsEmpty
      art={<NoAccessArt />}
      description="Ask an organization Owner or Admin if you need access to this section."
      title="You don't have access"
    />
  );
}

/**
 * A feature the plan or license doesn't include: one row with the Enterprise
 * chip. On our cloud the Owner gets See plans; self-hosted gets See License.
 */
export function LockedFeature({
  label,
  description,
  link,
}: {
  label: string;
  description: string;
  link: "plans" | "license" | null;
}) {
  return (
    <SettingsSection>
      <SettingsRows>
        <SettingsRow
          description={description}
          label={
            <Labelled
              badge={<Badge size="compact">Enterprise</Badge>}
              label={label}
            />
          }
        >
          {link === "license" ? (
            <Button asChild size="compact" variant="secondary">
              <Link to="/settings/organization/license">See License</Link>
            </Button>
          ) : link === "plans" ? (
            <Button asChild size="compact" variant="secondary">
              <Link to="/settings/organization/billing">See plans</Link>
            </Button>
          ) : null}
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  );
}

/** Text that may break after each "/", "." and "=", such as a URL or a DNS name. */
export function Breakable({ text }: { text: string }) {
  const parts = text.split(/(?<=[/.=])/);
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 ? <wbr /> : null}
    </Fragment>
  ));
}

/**
 * A value people copy: the whole value, never truncated, wrapping after each
 * "/", "." and "=", with a button that copies it. `field` shows the label
 * above it, as in a dialog; otherwise the label only names the button.
 */
export function WrapCopy({
  value,
  label,
  field = false,
  disabled,
}: {
  value: string;
  label: string;
  field?: boolean;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);
  const text = (
    <div className="flex min-w-0 items-start gap-2">
      <span
        className={
          "min-w-0 flex-1 py-1.5 font-mono text-caption break-normal " +
          (disabled ? "text-muted-foreground" : "text-foreground")
        }
      >
        <Breakable text={value} />
      </span>
      <Button
        aria-label={`Copy ${label}`}
        disabled={disabled}
        onClick={() =>
          void navigator.clipboard?.writeText(value).then(() => setCopied(true))
        }
        size="icon-compact"
        type="button"
        variant="ghost"
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
  if (!field) return text;
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      {text}
    </Field>
  );
}

/**
 * A copy value as a row's value. Its wrapper is w-0 min-w-full so the long
 * value wraps instead of widening the page at 390.
 */
export function CopyValue({
  value,
  label,
  disabled,
}: {
  value: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="w-0 min-w-full">
      <WrapCopy disabled={disabled} label={label} value={value} />
    </div>
  );
}

export function CopyRow({
  label,
  description,
  value,
  disabled,
}: {
  label: string;
  description?: string;
  value: string;
  disabled?: boolean;
}) {
  return (
    <SettingsRow
      description={description}
      label={label}
      value={<CopyValue disabled={disabled} label={label} value={value} />}
    />
  );
}
