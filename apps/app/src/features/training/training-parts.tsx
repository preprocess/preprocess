import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import { Input } from "@preprocess/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { Spinner } from "@preprocess/ui/components/spinner";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { ChevronRight } from "@preprocess/ui/lib/icons";
import type { ReactNode } from "react";

import { CouldntLoadArt, NoAccessArt } from "../../components/empty-art";
import { shortId } from "../evals/eval-api";
import {
  SettingsEmpty,
  SettingsRowSkeleton,
  SettingsRows,
  SettingsSection,
  formatRelative,
} from "../settings/kit";
import {
  CLOSED,
  NoCaseAccess,
  type ClosedStatus,
  type DatasetQuery,
  type ExportState,
  type Period,
} from "./training-api";

// Parts the Training tab and the dataset page share (PRE-145).

export const DEVELOPERS_ONLY = "Only Developers can export runs and datasets.";

export const PERIOD_LABELS: Record<Period | "custom", string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
  custom: "Custom range",
};

export const STATUS_LABELS: Record<ClosedStatus, string> = {
  completed: "Completed",
  failed: "Failed",
  halted: "Halted",
  cancelled: "Cancelled",
};

const counts = new Intl.NumberFormat("en");
export const formatCount = (n: number) => counts.format(n);

const day = (value: string) =>
  new Date(value).toLocaleDateString("en", { month: "short", day: "numeric" });

/** "2 hours ago" within a week, else "Nov 20"; capitalized to stand
 *  alone in a cell. */
export function formatUpdated(value: string, capitalize = true) {
  if (Date.now() - new Date(value).getTime() > 7 * 86_400_000)
    return day(value);
  const relative = formatRelative(value);
  return capitalize
    ? relative.charAt(0).toUpperCase() + relative.slice(1)
    : relative;
}

/** A date input's value (YYYY-MM-DD) as the start of that day, or back. */
export const fromDateInput = (value: string) =>
  value ? new Date(value + "T00:00:00").toISOString() : undefined;
export const toDateInput = (value: string | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate())
  );
};

/** "Last 90 days · Completed · Corrected": the query in one line. */
export function querySummary(query: DatasetQuery) {
  const parts = [
    query.period
      ? PERIOD_LABELS[query.period]
      : query.from || query.to
        ? (query.from ? day(query.from) : "") +
          " to " +
          (query.to ? day(query.to) : "")
        : PERIOD_LABELS.all,
  ];
  const status = query.status ?? [...CLOSED];
  if (status.length < CLOSED.length)
    parts.push(status.map((s) => STATUS_LABELS[s]).join(", "));
  if (query.deployments?.length)
    parts.push(query.deployments.map(shortId).join(", "));
  if (query.edited)
    parts.push(
      "any" in query.edited
        ? "Edited"
        : "fields" in query.edited
          ? "Edited " + query.edited.fields.join(", ")
          : "No edits",
    );
  if (query.outcome)
    parts.push(query.outcome === "corrected" ? "Corrected" : "Accepted");
  return parts.join(" · ");
}

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

export function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="truncate font-mono text-caption text-muted-foreground">
      {children}
    </span>
  );
}

export function Caption({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "danger";
}) {
  return (
    <span
      className={
        tone === "danger"
          ? "whitespace-normal text-caption text-destructive"
          : "whitespace-normal text-caption text-muted-foreground"
      }
    >
      {children}
    </span>
  );
}

export function Chevron() {
  return (
    <ChevronRight
      aria-hidden="true"
      className="size-4 shrink-0 text-muted-foreground"
    />
  );
}

export function LoadingSection({
  title,
  rows,
}: {
  title: string;
  rows: number;
}) {
  return (
    <SettingsSection title={title}>
      <SettingsRows>
        {Array.from({ length: rows }, (_, i) => (
          <SettingsRowSkeleton description={220} key={i} label={120} />
        ))}
      </SettingsRows>
    </SettingsSection>
  );
}

/** The page's failure: no access to the agent's cases, or Couldn't load. */
export function LoadFailure({
  error,
  title,
  description,
  onRetry,
}: {
  error: unknown;
  title: string;
  description: string;
  onRetry: () => void;
}) {
  if (error instanceof NoCaseAccess)
    return (
      <SettingsEmpty
        art={<NoAccessArt />}
        description="Datasets are built from this agent's cases. Ask an Owner or Admin to add you to a group with access."
        title="You can't see this agent's cases"
      />
    );
  return (
    <SettingsEmpty
      action={
        <Button onClick={onRetry} size="sm" type="button" variant="secondary">
          Try again
        </Button>
      }
      art={<CouldntLoadArt />}
      description={description}
      title={title}
    />
  );
}

export function PeriodSelect({
  value,
  onChange,
  disabled,
}: {
  value: Period | "custom";
  onChange: (value: Period | "custom") => void;
  disabled?: boolean;
}) {
  const options = Object.entries(PERIOD_LABELS) as [
    Period | "custom",
    string,
  ][];
  return (
    <Select
      disabled={disabled}
      onValueChange={(next) => onChange(next as Period | "custom")}
      value={value}
    >
      <SelectTrigger aria-label="Period" className="w-40" />
      <SelectContent>
        {options.map(([option, label], index) => (
          <SelectItem index={index} key={option} value={option}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "{from} to {to}" date inputs under a Custom range period. */
export function DateRange({
  from,
  to,
  onChange,
  error,
  disabled,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  return (
    <>
      <span className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="From"
          className="w-40"
          disabled={disabled}
          onChange={(event) => onChange({ from: event.target.value, to })}
          type="date"
          value={from}
        />
        <span className="text-caption text-muted-foreground">to</span>
        <Input
          aria-invalid={error ? true : undefined}
          aria-label="To"
          className="w-40"
          disabled={disabled}
          onChange={(event) => onChange({ from, to: event.target.value })}
          type="date"
          value={to}
        />
      </span>
      {error ? <Caption tone="danger">{error}</Caption> : null}
    </>
  );
}

export const RANGE_INVALID = "The end date is before the start date.";

export const rangeError = (from: string, to: string) =>
  from && to && to < from ? RANGE_INVALID : null;

/** An export's trailing control: Export, then progress, then Downloaded. */
export function ExportControls({
  state,
  doneLabel,
  onExport,
}: {
  state: ExportState;
  doneLabel: string;
  onExport: () => void;
}) {
  if (state.kind === "exporting")
    return (
      <span className="flex items-center gap-2">
        <span className="whitespace-nowrap text-caption text-muted-foreground tabular-nums">
          {state.total === null
            ? formatCount(state.done)
            : formatCount(state.done) + " of " + formatCount(state.total)}
        </span>
        <Button
          disabled
          leadingIcon={Spinner}
          size="compact"
          type="button"
          variant="secondary"
        >
          Exporting…
        </Button>
      </span>
    );
  if (state.kind === "done")
    return (
      <span className="flex items-center gap-2">
        <Badge color="green" size="compact" variant="dot">
          {doneLabel}
        </Badge>
        <Button
          onClick={onExport}
          size="compact"
          type="button"
          variant="secondary"
        >
          Export again
        </Button>
      </span>
    );
  return (
    <Button onClick={onExport} size="compact" type="button" variant="secondary">
      Export
    </Button>
  );
}

export const EXPORT_FAILED = "Couldn't export. Try again.";
