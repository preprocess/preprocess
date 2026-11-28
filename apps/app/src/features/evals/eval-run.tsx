import { Badge } from "@preprocess/ui/components/badge";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { ChevronDown } from "@preprocess/ui/lib/icons";
import { cn } from "@preprocess/ui/lib/utils";
import { useState } from "react";

import { EvalRunCasesArt } from "../../components/empty-art";

import {
  SettingsCard,
  SettingsEmpty,
  SettingsRow,
  SettingsRows,
  SettingsSection,
  formatRelative,
} from "../settings/kit";
import {
  RESULT_STATUS,
  RUN_STATUS,
  formatRate,
  formatUsd,
  shortId,
  type EvalResult,
  type EvalRunDetail,
} from "./eval-api";

const countFormat = new Intl.NumberFormat();

function Tile({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <SettingsCard className="flex flex-col gap-1 p-4">
      <span className="text-caption text-muted-foreground">{label}</span>
      <span
        className="text-title text-foreground tabular-nums"
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {value}
      </span>
    </SettingsCard>
  );
}

/**
 * One eval run: its totals, how often each answer field matched, and each
 * case's result. Refreshes while the run is in progress.
 */
export function EvalRunView({ run }: Readonly<{ run: EvalRunDetail }>) {
  const status = RUN_STATUS[run.status];
  return (
    <>
      <SettingsSection
        actions={<Badge color={status.color}>{status.label}</Badge>}
        description={`${run.model} on deployment ${shortId(run.deploymentId)} · ${
          run.trigger === "push"
            ? "Started by a new deployment"
            : "Started by hand"
        } ${formatRelative(run.createdAt)}${
          run.finishedAt ? ` · Finished ${formatRelative(run.finishedAt)}` : ""
        }`}
        title="Result"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Tile label="Pass rate" value={formatRate(run.passRate)} />
          <Tile label="Passed" value={countFormat.format(run.passed)} />
          <Tile
            label="Needed a person"
            value={countFormat.format(run.neededPerson)}
          />
          <Tile label="Failed" value={countFormat.format(run.failed)} />
          <Tile label="Cost" value={formatUsd(run.costUsd)} />
        </div>
      </SettingsSection>
      {run.fields.length > 0 ? (
        <SettingsSection
          description="How often each answer field matched the confirmed answer, across the cases scored."
          title="Fields"
        >
          <SettingsRows>
            {run.fields.map((field) => (
              <SettingsRow key={field.path} label={field.path}>
                <div className="flex w-48 items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-foreground/70"
                      style={{ width: `${Math.round(field.matchRate * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-caption text-foreground tabular-nums">
                    {formatRate(field.matchRate)}
                  </span>
                </div>
              </SettingsRow>
            ))}
          </SettingsRows>
        </SettingsSection>
      ) : null}
      <SettingsSection
        title={`Cases (${countFormat.format(run.results.length)} of ${countFormat.format(run.cases)})`}
      >
        {run.results.length === 0 ? (
          <SettingsEmpty
            art={<EvalRunCasesArt />}
            description="Scored cases appear here as this eval run finishes."
            title="No case results yet"
          />
        ) : (
          <SettingsCard className="flex flex-col divide-y divide-border/60">
            {run.results.map((result) => (
              <ResultRow key={result.caseId} result={result} />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>
    </>
  );
}

function ResultRow({ result }: Readonly<{ result: EvalResult }>) {
  const [open, setOpen] = useState(false);
  const status = RESULT_STATUS[result.status];
  const fields = result.fields ?? [];
  const missed = fields.filter((field) => !field.match).length;
  const expandable = fields.length > 0;
  return (
    <div className="flex flex-col">
      <button
        aria-expanded={expandable ? open : undefined}
        className="flex min-h-14 w-full items-center gap-4 px-5 py-2.5 text-left outline-none enabled:hover:bg-hover focus-visible:bg-hover"
        disabled={!expandable}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body text-foreground">
            {result.caseId}
          </span>
          <span className="truncate text-caption text-muted-foreground">
            {[
              result.reason,
              fields.length > 0
                ? missed === 0
                  ? `All ${fields.length} fields matched`
                  : `${missed} of ${fields.length} fields missed`
                : null,
              formatUsd(result.costUsd),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <Badge color={status.color}>{status.label}</Badge>
        {expandable ? (
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "shrink-0 text-muted-foreground transition-transform duration-150",
              open && "rotate-180",
            )}
            size={16}
          />
        ) : (
          <span aria-hidden="true" className="w-4 shrink-0" />
        )}
      </button>
      {open ? (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-5 pt-1 pb-4 text-caption">
          {fields.map((field) => (
            <div className="contents" key={field.path}>
              <dt className="min-w-0 truncate text-foreground">{field.path}</dt>
              <dd
                className={
                  field.match ? "text-muted-foreground" : "text-foreground"
                }
              >
                {field.match
                  ? "Matched"
                  : `Missed (score ${field.score.toFixed(2)})`}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export const runPolls = (run: EvalRunDetail) =>
  run.status === "queued" || run.status === "running";
