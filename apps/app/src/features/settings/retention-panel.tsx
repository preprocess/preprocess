"use client";

// Settings → Organization → Retention (spec 16a): how long documents, run
// capture, run logs and whole cases are kept after a case closes. Owners and
// Admins only; only Owners shorten a period, and a shortening Save asks first
// because the daily sweep deletes what is past it.

import { Button } from "@preprocess/ui/components/button";
import {
  AsyncActionAbortError,
  LoadingButton,
} from "@preprocess/ui/components/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { useEffect, useRef, useState } from "react";

import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";
import { ErrorLine } from "./guardrails-panel";
import {
  SettingsDialogShell,
  SettingsError,
  SettingsRow,
  SettingsRows,
  SettingsSection,
  SettingsRowSkeleton,
  SkeletonField,
} from "./kit";
import {
  MAX_DAYS,
  MIN_DAYS,
  shortens,
  useRetention,
  useSaveRetention,
  type Periods,
  type RetentionKey,
  type RetentionRole,
} from "./retention-api";
import { SettingsStacked } from "./settings-widgets";

const KINDS: readonly {
  key: RetentionKey;
  label: string;
  hint: string;
  presets: readonly number[];
  sweep: (days: string) => string;
}[] = [
  {
    key: "documentsDays",
    label: "Documents",
    hint: "Files people and agents added to a case.",
    presets: [30, 90, 365],
    sweep: (days) => `Cases closed more than ${days} ago lose their files.`,
  },
  {
    key: "runCaptureDays",
    label: "Run capture",
    hint: "The recorded run: model and tool calls, results, cost and timing.",
    presets: [30, 90, 365],
    sweep: (days) =>
      `Cases closed more than ${days} ago lose their run capture.`,
  },
  {
    key: "runLogsDays",
    label: "Run logs",
    hint: "Logs written while the case ran.",
    presets: [30, 90, 365],
    sweep: (days) => `Cases closed more than ${days} ago lose their run logs.`,
  },
  {
    key: "casesDays",
    label: "Cases",
    hint: "The whole case, with its files, capture, logs and review history.",
    presets: [30, 90, 365],
    sweep: (days) =>
      `Cases closed more than ${days} ago are deleted with everything in them, and leave eval suites.`,
  },
];

const FOREVER = "forever";
const CUSTOM = "custom";

type Draft = { choice: string; custom: string };
type Drafts = Record<RetentionKey, Draft>;

const daysLabel = (days: number) =>
  days === 1 ? "1 day" : `${days.toLocaleString("en-US")} days`;

const draftOf = (days: number | null, presets: readonly number[]): Draft =>
  days === null
    ? { choice: FOREVER, custom: "" }
    : presets.includes(days)
      ? { choice: String(days), custom: "" }
      : { choice: CUSTOM, custom: String(days) };

const draftsOf = (periods: Periods) =>
  Object.fromEntries(
    KINDS.map((kind) => [kind.key, draftOf(periods[kind.key], kind.presets)]),
  ) as Drafts;

// The period a draft names; NaN while a custom value isn't a number yet.
const daysOf = (draft: Draft): number | null =>
  draft.choice === FOREVER
    ? null
    : draft.choice === CUSTOM
      ? /^\d+$/.test(draft.custom.replaceAll(",", "").trim())
        ? Number(draft.custom.replaceAll(",", "").trim())
        : Number.NaN
      : Number(draft.choice);

// Mirrors the API's messages.
const validateDays = (text: string) => {
  const value = text.replaceAll(",", "").trim();
  if (value === "") return "Enter a number of days.";
  if (!/^\d+$/.test(value))
    return "A retention period is a whole number of days.";
  if (Number(value) < MIN_DAYS)
    return `A retention period is at least ${MIN_DAYS} days.`;
  if (Number(value) > MAX_DAYS)
    return "A retention period is at most 36,500 days.";
  return null;
};

const ONLY_OWNERS = "Only Owners can shorten a period.";

export function RetentionPanel({ role }: { role: RetentionRole }) {
  const retention = useRetention();
  const save = useSaveRetention();
  const saved = retention.data;
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [confirming, setConfirming] = useState<Partial<Periods> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const fields = useRef<Partial<Record<RetentionKey, ValidatedFieldHandle>>>(
    {},
  );
  useEffect(() => {
    if (saved) setDrafts(draftsOf(saved));
  }, [saved]);

  const owner = role === "owner";
  const change: Partial<Periods> = {};
  if (saved && drafts)
    for (const kind of KINDS) {
      const days = daysOf(drafts[kind.key]);
      if (days !== saved[kind.key]) change[kind.key] = days;
    }
  const changed = Object.keys(change) as RetentionKey[];

  const submit = async (next: Partial<Periods>) => {
    setError(null);
    await save(next);
  };

  return (
    <SettingsStacked>
      <SettingsSection
        actions={
          saved && drafts ? (
            <LoadingButton
              disabled={changed.length === 0}
              onAction={async () => {
                setError(null);
                const valid = KINDS.map(
                  (kind) =>
                    drafts[kind.key].choice !== CUSTOM ||
                    (fields.current[kind.key]?.commit() ?? true),
                ).every(Boolean);
                if (!valid) throw new AsyncActionAbortError();
                if (
                  changed.some((key) =>
                    shortens(saved[key], change[key] ?? null),
                  )
                ) {
                  setConfirming(change);
                  throw new AsyncActionAbortError();
                }
                await submit(change);
              }}
              onError={setError}
              pendingLabel="Saving…"
              successLabel="Saved"
            >
              Save
            </LoadingButton>
          ) : null
        }
        description="How long each kind of data is kept after its case closes. Open cases are never touched, and a daily sweep deletes what is past its period."
        title="Retention periods"
      >
        {retention.isError ? (
          <SettingsError error={retention.error} />
        ) : !saved || !drafts ? (
          <SettingsRows>
            {KINDS.map((kind) => (
              <SettingsRowSkeleton
                description={kind.hint}
                key={kind.key}
                label={kind.label}
                value={<SkeletonField className="w-full sm:w-56" />}
              />
            ))}
          </SettingsRows>
        ) : (
          <SettingsRows>
            {KINDS.map((kind) => {
              const draft = drafts[kind.key];
              const before = saved[kind.key];
              const set = (next: Draft) =>
                setDrafts({ ...drafts, [kind.key]: next });
              const blocked = (days: number | null) =>
                !owner && shortens(before, days);
              const options = [
                { value: FOREVER, label: "Forever", days: null },
                ...kind.presets.map((days) => ({
                  value: String(days),
                  label: daysLabel(days),
                  days,
                })),
              ];
              return (
                <SettingsRow
                  description={
                    !owner ? (
                      <>
                        {kind.hint} {ONLY_OWNERS}
                      </>
                    ) : (
                      kind.hint
                    )
                  }
                  key={kind.key}
                  label={kind.label}
                  value={
                    <div className="flex w-full flex-col gap-3">
                      <Select
                        onValueChange={(choice) =>
                          set({
                            choice,
                            custom:
                              choice === CUSTOM && !draft.custom
                                ? String(before ?? "")
                                : draft.custom,
                          })
                        }
                        value={draft.choice}
                      >
                        <SelectTrigger
                          aria-label={`Keep ${kind.label.toLowerCase()}`}
                          className="w-full sm:w-56"
                        />
                        <SelectContent>
                          {options.map((option, index) => (
                            <SelectItem
                              disabled={blocked(option.days)}
                              index={index}
                              key={option.value}
                              value={option.value}
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                          <SelectItem
                            disabled={!owner && before === null}
                            index={options.length}
                            value={CUSTOM}
                          >
                            Custom
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {draft.choice === CUSTOM ? (
                        <ValidatedField
                          className="w-full sm:w-56"
                          hint={`${MIN_DAYS} to 36,500 days after the case closes`}
                          inputMode="numeric"
                          label="Days"
                          onChange={(custom) => set({ ...draft, custom })}
                          placeholder="180"
                          ref={(handle) => {
                            fields.current[kind.key] = handle ?? undefined;
                          }}
                          validate={(text) =>
                            validateDays(text) ??
                            (blocked(Number(text.replaceAll(",", "").trim()))
                              ? ONLY_OWNERS
                              : null)
                          }
                          value={draft.custom}
                        />
                      ) : null}
                    </div>
                  }
                />
              );
            })}
          </SettingsRows>
        )}
        <ErrorLine
          error={error}
          fallback="Could not save the retention periods."
        />
        <p className="pl-1 text-caption text-muted-foreground">
          The audit log is kept separately for at least one year and isn't
          affected by these periods.
        </p>
      </SettingsSection>
      {saved && confirming ? (
        <ShortenDialog
          before={saved}
          change={confirming}
          onClose={() => setConfirming(null)}
          onConfirm={() => submit(confirming)}
        />
      ) : null}
    </SettingsStacked>
  );
}

function ShortenDialog({
  before,
  change,
  onClose,
  onConfirm,
}: {
  before: Periods;
  change: Partial<Periods>;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const shortened = KINDS.filter(
    (kind) =>
      kind.key in change &&
      shortens(before[kind.key], change[kind.key] ?? null),
  );
  return (
    <SettingsDialogShell
      description="The next daily sweep deletes what is past the new period, and it can't be restored. Open cases aren't touched."
      footer={
        <>
          <Button
            disabled={pending}
            onClick={onClose}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <LoadingButton
            onAction={async () => {
              setError(null);
              await onConfirm();
            }}
            onError={setError}
            onStatusChange={(status) => {
              setPending(status === "pending");
              if (status === "success") window.setTimeout(onClose, 600);
            }}
            pendingLabel="Saving…"
            successLabel="Saved"
          >
            Shorten and delete
          </LoadingButton>
        </>
      }
      onOpenChange={(open) => (open ? null : onClose())}
      open
      title={
        shortened.length === 1
          ? `Shorten ${shortened[0].label.toLowerCase()} retention?`
          : "Shorten retention?"
      }
    >
      <div className="flex flex-col divide-y divide-border">
        {shortened.map((kind) => {
          const days = daysLabel(change[kind.key]!);
          const was = before[kind.key];
          return (
            <div className="flex flex-col gap-1.5 py-4" key={kind.key}>
              <span className="text-body text-foreground">
                {`${kind.label}, from ${was === null ? "Forever" : daysLabel(was)} to ${days}`}
              </span>
              <span className="text-caption text-muted-foreground">
                {kind.sweep(days)}
              </span>
            </div>
          );
        })}
      </div>
      <ErrorLine
        error={error}
        fallback="Could not save the retention periods."
      />
    </SettingsDialogShell>
  );
}
