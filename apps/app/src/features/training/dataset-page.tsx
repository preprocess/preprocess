import {
  CheckboxGroup,
  CheckboxItem,
} from "@preprocess/ui/components/checkbox-group";
import {
  Combobox,
  ComboboxChips,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
} from "@preprocess/ui/components/combobox";
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
import { Spinner } from "@preprocess/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@preprocess/ui/components/table";
import { Tabs, TabsItem } from "@preprocess/ui/components/tabs";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { NoResultsArt } from "../../components/empty-art";
import type {
  AgentCaseRef,
  AgentId,
  CaseId,
} from "../agent-cases/agent-case-ref";
import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";
import { ApiError } from "../auth/client";
import {
  SettingsCard,
  SettingsConfirmDialog,
  SettingsDialog,
  SettingsDialogActions,
  SettingsEmpty,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRowMenu,
  SettingsRowSkeleton,
  SettingsRows,
  SettingsSection,
  actionErrorMessage,
} from "../settings/kit";
import { SettingsStacked } from "../settings/settings-widgets";
import {
  CLOSED,
  deploymentLabel,
  seededFields,
  useCanExport,
  useDataset,
  useDatasetExport,
  useDatasetWrites,
  useDeployments,
  usePreview,
  type ClosedStatus,
  type Dataset,
  type DatasetFormat,
  type DatasetQuery,
  type Period,
} from "./training-api";
import { nameValidator } from "./training-tab";
import {
  Caption,
  Chevron,
  DEVELOPERS_ONLY,
  DateRange,
  EXPORT_FAILED,
  ExportControls,
  LoadFailure,
  LoadingSection,
  Mono,
  PeriodSelect,
  STATUS_LABELS,
  formatCount,
  formatUpdated,
  fromDateInput,
  rangeError,
  toDateInput,
} from "./training-parts";

type EditedMode = "any-or-none" | "any" | "fields" | "none";
type Outcome = "any" | "corrected" | "accepted";

/** The query as the form edits it. */
type Draft = {
  period: Period | "custom";
  from: string;
  to: string;
  status: ClosedStatus[];
  deployments: string[];
  edited: EditedMode;
  fields: string[];
  outcome: Outcome;
};

const OUTCOMES: Outcome[] = ["any", "corrected", "accepted"];
const OUTCOME_LABELS = {
  any: "Any",
  corrected: "Corrected",
  accepted: "Accepted",
};

const EDITED_OPTIONS: [EditedMode, string][] = [
  ["any-or-none", "Any or none"],
  ["any", "Any field edited"],
  ["fields", "These fields"],
  ["none", "No edits"],
];

function toDraft(query: DatasetQuery): Draft {
  return {
    period: query.period ?? (query.from || query.to ? "custom" : "all"),
    from: toDateInput(query.from),
    to: query.to
      ? toDateInput(new Date(new Date(query.to).getTime() - 1).toISOString())
      : "",
    status: query.status ?? [...CLOSED],
    deployments: query.deployments ?? [],
    edited: !query.edited
      ? "any-or-none"
      : "any" in query.edited
        ? "any"
        : "fields" in query.edited
          ? "fields"
          : "none",
    fields: query.edited && "fields" in query.edited ? query.edited.fields : [],
    outcome: query.outcome ?? "any",
  };
}

function toQuery(draft: Draft): DatasetQuery {
  const query: DatasetQuery = {};
  if (draft.period === "custom") {
    const from = fromDateInput(draft.from);
    const to = draft.to ? fromDateInput(nextDay(draft.to)) : undefined;
    if (from) query.from = from;
    if (to) query.to = to;
  } else query.period = draft.period;
  if (draft.status.length)
    query.status = CLOSED.filter((s) => draft.status.includes(s));
  if (draft.deployments.length) query.deployments = draft.deployments;
  if (draft.edited === "any") query.edited = { any: true };
  if (draft.edited === "none") query.edited = { none: true };
  if (draft.edited === "fields" && draft.fields.length)
    query.edited = { fields: draft.fields };
  if (draft.outcome !== "any") query.outcome = draft.outcome;
  return query;
}

function nextDay(value: string) {
  const date = new Date(value + "T00:00:00");
  date.setDate(date.getDate() + 1);
  return toDateInput(date.toISOString());
}

const STATUS_REQUIRED = "Pick at least one status.";

function draftErrors(draft: Draft) {
  return {
    range: draft.period === "custom" ? rangeError(draft.from, draft.to) : null,
    status: draft.status.length ? null : STATUS_REQUIRED,
  };
}

/** One dataset (PRE-145 §3): its query, a live preview and its exports. */
export function DatasetPage({
  agentSlug,
  datasetId,
}: Readonly<{ agentSlug: string; datasetId: string }>) {
  const dataset = useDataset(agentSlug, datasetId);

  if (dataset.isPending)
    return (
      <SettingsStacked>
        <LoadingSection rows={5} title="Query" />
        <LoadingSection rows={6} title="Preview" />
      </SettingsStacked>
    );
  if (dataset.isError)
    return (
      <LoadFailure
        description="Something went wrong loading this dataset. Try again."
        error={dataset.error}
        onRetry={() => void dataset.refetch()}
        title="Couldn't load this dataset"
      />
    );
  return (
    <DatasetView
      agentSlug={agentSlug}
      dataset={dataset.data}
      key={dataset.data.updatedAt}
    />
  );
}

function DatasetView({
  agentSlug,
  dataset,
}: {
  agentSlug: string;
  dataset: Dataset;
}) {
  const canExport = useCanExport();
  const { update } = useDatasetWrites(agentSlug);
  const saved = toDraft(dataset.query);
  const [draft, setDraft] = useState(saved);
  const [showErrors, setShowErrors] = useState(false);
  const change = (next: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...next }));

  const errors = draftErrors(draft);
  const valid = !errors.range && !errors.status;
  const query = toQuery(draft);
  const dirty = JSON.stringify(query) !== JSON.stringify(toQuery(saved));

  // The preview follows the query ~300 ms after it changes, while it's valid.
  const [previewQuery, setPreviewQuery] = useState(query);
  const encoded = JSON.stringify(query);
  useEffect(() => {
    if (!valid) return;
    const timer = setTimeout(
      () => setPreviewQuery(JSON.parse(encoded) as DatasetQuery),
      300,
    );
    return () => clearTimeout(timer);
  }, [encoded, valid]);
  const preview = usePreview(agentSlug, dataset.id, previewQuery);
  const settling = encoded !== JSON.stringify(previewQuery) && valid;
  const updating =
    settling || (preview.isFetching && preview.isPlaceholderData);

  const save = async () => {
    if (!valid) {
      setShowErrors(true);
      throw new AsyncActionAbortError();
    }
    await update(dataset.id, { query });
  };

  const none = preview.data?.count === 0 && !updating;
  const total = !dirty && preview.data ? preview.data.count : dataset.count;

  return (
    <SettingsStacked>
      <DatasetHeader
        agentSlug={agentSlug}
        canWrite={canExport}
        dataset={dataset}
      />
      <SettingsSection
        actions={
          canExport ? (
            <LoadingButton
              disabled={!dirty}
              onAction={save}
              pendingLabel="Saving…"
              size="compact"
              type="button"
              variant="primary"
            >
              Save query
            </LoadingButton>
          ) : null
        }
        description="Only closed cases are included. New ones join as they close."
        title="Query"
      >
        <QueryRows
          agentSlug={agentSlug}
          change={change}
          draft={draft}
          errors={showErrors ? errors : { range: null, status: null }}
          fieldsSeen={preview.data?.cases.flatMap((c) => c.editedFields) ?? []}
          readOnly={!canExport}
        />
      </SettingsSection>
      <SettingsSection
        actions={
          updating ? (
            <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <Spinner className="size-3.5" />
              Updating
            </span>
          ) : null
        }
        description={
          updating
            ? "Counting the cases that match…"
            : preview.data
              ? preview.data.count === 0
                ? "No closed cases match this query."
                : formatCount(preview.data.count) +
                  " cases match. The newest 20 are shown."
              : undefined
        }
        title="Preview"
      >
        {preview.isPending ? (
          <SettingsRows>
            {Array.from({ length: 6 }, (_, i) => (
              <SettingsRowSkeleton description={220} key={i} label={120} />
            ))}
          </SettingsRows>
        ) : preview.isError ? (
          <LoadFailure
            description="Something went wrong loading this dataset. Try again."
            error={preview.error}
            onRetry={() => void preview.refetch()}
            title="Couldn't load this dataset"
          />
        ) : none ? (
          <SettingsEmpty
            art={<NoResultsArt />}
            description="Widen the period, add a status or set Outcome to Any."
            title="No cases match"
          />
        ) : (
          <div className={updating ? "opacity-50" : undefined}>
            <PreviewTable agentSlug={agentSlug} cases={preview.data.cases} />
          </div>
        )}
      </SettingsSection>
      {none ? null : (
        <SettingsSection
          description="One line per case. Every export is recorded in the audit log."
          title="Export"
        >
          <SettingsRows>
            {FORMATS.map((format) => (
              <ExportRow
                agentSlug={agentSlug}
                canExport={canExport}
                dataset={dataset}
                format={format}
                key={format.id}
                total={total}
              />
            ))}
          </SettingsRows>
          {canExport ? null : (
            <p className="px-5 text-caption text-muted-foreground">
              {DEVELOPERS_ONLY}
            </p>
          )}
        </SettingsSection>
      )}
    </SettingsStacked>
  );
}

function DatasetHeader({
  agentSlug,
  dataset,
  canWrite,
}: {
  agentSlug: string;
  dataset: Dataset;
  canWrite: boolean;
}) {
  const navigate = useNavigate();
  const { remove } = useDatasetWrites(agentSlug);
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1
          className="truncate text-title tracking-[-0.02em] text-foreground"
          style={{ fontVariationSettings: fontWeights.medium }}
        >
          {dataset.name}
        </h1>
        <Caption>
          {"Updated " +
            formatUpdated(dataset.updatedAt, false) +
            (dataset.updatedBy ? " by " + dataset.updatedBy : "")}
        </Caption>
      </div>
      {canWrite ? (
        <SettingsRowMenu
          actions={[
            { label: "Rename", onSelect: () => setDialog("rename") },
            { label: "Delete", onSelect: () => setDialog("delete") },
          ]}
          label="Dataset actions"
        />
      ) : null}
      <SettingsDialog
        content={(close) => (
          <RenameForm agentSlug={agentSlug} close={close} dataset={dataset} />
        )}
        onOpenChange={(open) => setDialog(open ? "rename" : null)}
        open={dialog === "rename"}
        title="Rename dataset"
      />
      <SettingsConfirmDialog
        confirmLabel="Delete"
        description="Its cases and earlier exports aren't touched."
        onConfirm={async () => {
          await remove(dataset.id);
          await navigate({
            to: "/agents/$agentId/training",
            params: { agentId: agentSlug },
          });
        }}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
        open={dialog === "delete"}
        pendingLabel="Deleting…"
        successLabel="Deleted"
        title={"Delete " + dataset.name + "?"}
      />
    </div>
  );
}

function RenameForm({
  agentSlug,
  dataset,
  close,
}: {
  agentSlug: string;
  dataset: Dataset;
  close: () => void;
}) {
  const { update } = useDatasetWrites(agentSlug);
  const nameRef = useRef<ValidatedFieldHandle>(null);
  const [name, setName] = useState(dataset.name);
  const [taken, setTaken] = useState(() => new Set<string>());
  // A name the API refused shows its error once validation knows it.
  useEffect(() => {
    if (taken.size) nameRef.current?.commit();
  }, [taken]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    if (!nameRef.current?.commit()) throw new AsyncActionAbortError();
    try {
      await update(dataset.id, { name: name.trim() });
      close();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setTaken((names) => new Set(names).add(name.trim()));
        throw new AsyncActionAbortError();
      }
      setError(actionErrorMessage(cause, "Something went wrong. Try again."));
      throw cause;
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}
    >
      <ValidatedField
        ref={nameRef}
        autoComplete="off"
        id="dataset-rename"
        label="Name"
        onChange={setName}
        validate={nameValidator(taken)}
        value={name}
      />
      {error ? (
        <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
      ) : null}
      <SettingsDialogActions onCancel={close} pending={pending}>
        <LoadingButton
          onAction={onSave}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Saving…"
          type="button"
        >
          Save
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}

function ChipsField({
  label,
  placeholder,
  items,
  value,
  onChange,
  disabled,
}: {
  label: string;
  placeholder: string;
  items: { value: string; label: string }[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <Combobox
      disabled={disabled}
      items={items}
      multiple
      onValueChange={onChange}
      value={value}
    >
      <ComboboxChips aria-label={label} placeholder={placeholder} />
      <ComboboxContent>
        <ComboboxList>
          {(entry: { value: string; label: string } | string) =>
            typeof entry === "string" ? null : (
              <ComboboxItem key={entry.value} value={entry.value}>
                {entry.label}
              </ComboboxItem>
            )
          }
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function QueryRows({
  agentSlug,
  draft,
  change,
  errors,
  fieldsSeen,
  readOnly,
}: {
  agentSlug: string;
  draft: Draft;
  change: (next: Partial<Draft>) => void;
  errors: { range: string | null; status: string | null };
  fieldsSeen: string[];
  readOnly: boolean;
}) {
  const deployments = useDeployments(agentSlug);
  const fields = [
    ...new Set([...seededFields(), ...fieldsSeen, ...draft.fields]),
  ];
  return (
    <SettingsRows>
      <SettingsRow
        description={
          draft.period === "custom" ? undefined : "When the case was created"
        }
        label="Period"
        value={
          <span className="flex w-full flex-col gap-2">
            <PeriodSelect
              disabled={readOnly}
              onChange={(period) => change({ period })}
              value={draft.period}
            />
            {draft.period === "custom" ? (
              <DateRange
                disabled={readOnly}
                error={errors.range}
                from={draft.from}
                onChange={change}
                to={draft.to}
              />
            ) : null}
          </span>
        }
      />
      <SettingsRow
        label="Status"
        value={
          <span className="flex w-full flex-col gap-1">
            <CheckboxGroup
              aria-invalid={errors.status ? true : undefined}
              checkedIndices={
                new Set(
                  CLOSED.flatMap((status, index) =>
                    draft.status.includes(status) ? [index] : [],
                  ),
                )
              }
            >
              {CLOSED.map((status, index) => (
                <CheckboxItem
                  aria-disabled={readOnly}
                  checked={draft.status.includes(status)}
                  index={index}
                  key={status}
                  label={STATUS_LABELS[status]}
                  onToggle={() => {
                    if (readOnly) return;
                    change({
                      status: draft.status.includes(status)
                        ? draft.status.filter((s) => s !== status)
                        : [...draft.status, status],
                    });
                  }}
                />
              ))}
            </CheckboxGroup>
            {errors.status ? (
              <Caption tone="danger">{errors.status}</Caption>
            ) : null}
          </span>
        }
      />
      <SettingsRow
        description="All deployments when empty"
        label="Deployments"
        value={
          <ChipsField
            disabled={readOnly}
            items={(deployments.data ?? []).map((deployment) => ({
              value: deployment.id,
              label: deploymentLabel(deployment),
            }))}
            label="Deployments"
            onChange={(value) => change({ deployments: value })}
            placeholder="All deployments"
            value={draft.deployments}
          />
        }
      />
      <SettingsRow
        label="Edited fields"
        value={
          <span className="flex w-full flex-col gap-2">
            <Select
              disabled={readOnly}
              onValueChange={(value) => change({ edited: value as EditedMode })}
              value={draft.edited}
            >
              <SelectTrigger aria-label="Edited fields" className="w-44" />
              <SelectContent>
                {EDITED_OPTIONS.map(([value, label], index) => (
                  <SelectItem index={index} key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.edited === "fields" ? (
              <ChipsField
                disabled={readOnly}
                items={fields.map((field) => ({ value: field, label: field }))}
                label="Fields"
                onChange={(value) => change({ fields: value })}
                placeholder="Pick fields"
                value={draft.fields}
              />
            ) : null}
          </span>
        }
      />
      <SettingsRow
        description="Corrected: a person edited the answer. Accepted: completed with no edits."
        label="Outcome"
        value={
          <Tabs
            aria-label="Outcome"
            onSelect={(index) => {
              if (!readOnly) change({ outcome: OUTCOMES[index] });
            }}
            selectedIndex={OUTCOMES.indexOf(draft.outcome)}
            size="compact"
          >
            {OUTCOMES.map((outcome, index) => (
              <TabsItem
                index={index}
                key={outcome}
                label={OUTCOME_LABELS[outcome]}
              />
            ))}
          </Tabs>
        }
      />
    </SettingsRows>
  );
}

const caseRef = (agent: string, id: string): AgentCaseRef => ({
  agentId: agent as AgentId,
  caseId: id as CaseId,
});

function completed(value: string | null) {
  return value ? formatUpdated(value) : "";
}

function PreviewTable({
  agentSlug,
  cases,
}: {
  agentSlug: string;
  cases: {
    id: string;
    title: string | null;
    completedAt: string | null;
    editedFields: string[];
  }[];
}) {
  const navigate = useNavigate();
  return (
    <>
      <div className="hidden sm:block">
        <SettingsCard table>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case</TableHead>
                <TableHead className="w-48">Edited</TableHead>
                <TableHead className="w-32">Completed</TableHead>
                <TableHead className="w-8">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((item, index) => (
                <TableRow
                  className="cursor-pointer"
                  index={index}
                  key={item.id}
                  onClick={() =>
                    void navigate({
                      to: "/agents/$agentId/cases/$caseId",
                      params: caseRef(agentSlug, item.id),
                    })
                  }
                >
                  <TableCell className="max-w-0">
                    <span className="block truncate">
                      {item.title ?? item.id}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-0">
                    <Mono>{item.editedFields.join(", ")}</Mono>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {completed(item.completedAt)}
                  </TableCell>
                  <TableCell>
                    <Link
                      onClick={(event) => event.stopPropagation()}
                      params={caseRef(agentSlug, item.id)}
                      to="/agents/$agentId/cases/$caseId"
                    >
                      <Chevron />
                      <span className="sr-only">Open</span>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SettingsCard>
      </div>
      <div className="sm:hidden">
        <SettingsRows>
          {cases.map((item) => (
            <Link
              className="flex items-center justify-between gap-3 px-5 py-3 outline-none hover:bg-hover focus-visible:bg-hover"
              key={item.id}
              params={caseRef(agentSlug, item.id)}
              to="/agents/$agentId/cases/$caseId"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-body text-foreground">
                  {item.title ?? item.id}
                </span>
                <Caption>
                  {[item.editedFields.join(", "), completed(item.completedAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </Caption>
              </div>
              <Chevron />
            </Link>
          ))}
        </SettingsRows>
      </div>
    </>
  );
}

const FORMATS: { id: DatasetFormat; label: string; detail: string }[] = [
  {
    id: "sft",
    label: "Supervised examples",
    detail:
      "Each case's model conversation, ending in the answer people approved.",
  },
  {
    id: "preference",
    label: "Preference pairs",
    detail:
      "The agent's answer against the person's correction, for edited cases only.",
  },
  {
    id: "replay",
    label: "Replayable runs",
    detail:
      "Each case's full run and review events, to replay with another model.",
  },
];

function ExportRow({
  agentSlug,
  dataset,
  format,
  total,
  canExport,
}: {
  agentSlug: string;
  dataset: Dataset;
  format: (typeof FORMATS)[number];
  total: number | null;
  canExport: boolean;
}) {
  const { state, start } = useDatasetExport(
    agentSlug,
    dataset,
    format.id,
    total,
  );
  return (
    <SettingsRow
      description={
        state.kind === "idle" && state.failed ? (
          <span className="text-destructive">{EXPORT_FAILED}</span>
        ) : (
          format.detail
        )
      }
      label={format.label}
    >
      {canExport ? (
        <ExportControls
          doneLabel={
            "Downloaded " +
            (state.kind === "done" ? formatCount(state.count) : "")
          }
          onExport={() => void start()}
          state={state}
        />
      ) : null}
    </SettingsRow>
  );
}
