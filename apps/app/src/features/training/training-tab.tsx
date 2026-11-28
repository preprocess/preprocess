import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  AsyncActionAbortError,
  LoadingButton,
} from "@preprocess/ui/components/loading-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@preprocess/ui/components/table";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { NothingCreatedArt } from "../../components/empty-art";
import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";
import { ApiError } from "../auth/client";
import {
  SettingsCard,
  SettingsDialog,
  SettingsDialogActions,
  SettingsEmpty,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRows,
  SettingsSection,
  actionErrorMessage,
} from "../settings/kit";
import { SettingsStacked } from "../settings/settings-widgets";
import {
  useCaptureExport,
  useCanExport,
  useDatasetWrites,
  useDatasets,
  useTrainingOn,
  type Dataset,
  type Period,
} from "./training-api";
import {
  Caption,
  Chevron,
  DEVELOPERS_ONLY,
  DateRange,
  EXPORT_FAILED,
  ExportControls,
  LoadFailure,
  LoadingSection,
  PERIOD_LABELS,
  PeriodSelect,
  Strong,
  formatCount,
  formatUpdated,
  fromDateInput,
  querySummary,
  rangeError,
} from "./training-parts";

/** An agent's Training tab (PRE-145 §2): its datasets, run capture's
 *  export, and what's coming once the training switch is on. */
export function AgentTrainingTab({
  agentSlug,
}: Readonly<{ agentSlug: string }>) {
  const datasets = useDatasets(agentSlug);
  const canExport = useCanExport();
  const trainingOn = useTrainingOn();
  const [creating, setCreating] = useState(false);

  if (datasets.isPending)
    return (
      <SettingsStacked>
        <LoadingSection rows={3} title="Datasets" />
        <LoadingSection rows={1} title="Run capture" />
      </SettingsStacked>
    );
  if (datasets.isError)
    return (
      <LoadFailure
        description="Something went wrong loading this agent's datasets. Try again."
        error={datasets.error}
        onRetry={() => void datasets.refetch()}
        title="Couldn't load training data"
      />
    );

  const empty = datasets.data.length === 0;
  return (
    <SettingsStacked>
      <SettingsSection
        actions={
          canExport && !empty ? (
            <Button
              onClick={() => setCreating(true)}
              size="compact"
              type="button"
              variant="secondary"
            >
              New dataset
            </Button>
          ) : null
        }
        description="Saved queries over this agent's closed cases, ready to export for training."
        title="Datasets"
      >
        {empty ? (
          <SettingsEmpty
            action={
              canExport ? (
                <Button
                  onClick={() => setCreating(true)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  New dataset
                </Button>
              ) : undefined
            }
            art={<NothingCreatedArt />}
            description="A dataset picks cases by period, status, deployment and what people changed. It stays current as cases close."
            title="No datasets yet"
          />
        ) : (
          <DatasetList agentSlug={agentSlug} datasets={datasets.data} />
        )}
      </SettingsSection>
      <RunCapture agentSlug={agentSlug} canExport={canExport} />
      {trainingOn ? (
        <div className="flex flex-col gap-2">
          <ComingSoonLine label="Training runs" />
          <ComingSoonLine label="Retrain on corrections" />
        </div>
      ) : null}
      <NewDatasetDialog
        agentSlug={agentSlug}
        onOpenChange={setCreating}
        open={creating}
      />
    </SettingsStacked>
  );
}

function ComingSoonLine({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 px-5 text-caption text-muted-foreground">
      {label}
      <Badge size="compact">Coming soon</Badge>
    </p>
  );
}

const cases = (n: number | null) => (n === null ? "" : formatCount(n));

function DatasetList({
  agentSlug,
  datasets,
}: {
  agentSlug: string;
  datasets: Dataset[];
}) {
  const navigate = useNavigate();
  const open = (dataset: Dataset) =>
    void navigate({
      to: "/agents/$agentId/training/datasets/$datasetId",
      params: { agentId: agentSlug, datasetId: dataset.id },
    });
  return (
    <>
      <div className="hidden sm:block">
        <SettingsCard table>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dataset</TableHead>
                <TableHead className="w-24 text-right">Cases</TableHead>
                <TableHead className="w-32">Updated</TableHead>
                <TableHead className="w-8">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {datasets.map((dataset, index) => (
                <TableRow
                  className="cursor-pointer"
                  index={index}
                  key={dataset.id}
                  onClick={() => open(dataset)}
                >
                  <TableCell className="max-w-0">
                    <div className="flex min-w-0 flex-col gap-0.5 py-2">
                      <Strong>{dataset.name}</Strong>
                      <Caption>{querySummary(dataset.query)}</Caption>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {cases(dataset.count)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatUpdated(dataset.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <Link
                      onClick={(event) => event.stopPropagation()}
                      params={{ agentId: agentSlug, datasetId: dataset.id }}
                      to="/agents/$agentId/training/datasets/$datasetId"
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
          {datasets.map((dataset) => (
            <Link
              className="flex items-center justify-between gap-3 px-5 py-3 outline-none hover:bg-hover focus-visible:bg-hover"
              key={dataset.id}
              params={{ agentId: agentSlug, datasetId: dataset.id }}
              to="/agents/$agentId/training/datasets/$datasetId"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <Strong>{dataset.name}</Strong>
                <Caption>
                  {(dataset.count === null
                    ? ""
                    : formatCount(dataset.count) + " cases · ") +
                    querySummary(dataset.query)}
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

function RunCapture({
  agentSlug,
  canExport,
}: {
  agentSlug: string;
  canExport: boolean;
}) {
  const { state, start } = useCaptureExport(agentSlug);
  const [period, setPeriod] = useState<Period | "custom">("30d");
  const [range, setRange] = useState({ from: "", to: "" });
  const [rangeShown, setRangeShown] = useState(false);
  const error = rangeShown ? rangeError(range.from, range.to) : null;

  const exportRuns = () => {
    if (period === "custom" && rangeError(range.from, range.to)) {
      setRangeShown(true);
      return;
    }
    void start(
      period === "custom"
        ? { from: fromDateInput(range.from), to: nextDay(range.to) }
        : { period },
    );
  };

  return (
    <SettingsSection
      description="Every closed case keeps its full run: model and tool calls, decisions and each edit people made."
      title="Run capture"
    >
      <SettingsRows>
        <SettingsRow
          description={
            state.kind === "done" ? (
              formatCount(state.count) +
              " cases exported." +
              (state.skipped
                ? " " +
                  formatCount(state.skipped) +
                  " past retention were skipped."
                : "")
            ) : state.kind === "idle" && state.failed ? (
              <span className="text-destructive">{EXPORT_FAILED}</span>
            ) : (
              "One line per case, with its run and review events."
            )
          }
          label="Export runs"
          value={
            canExport ? (
              <span className="flex w-full flex-col gap-2">
                <PeriodSelect
                  disabled={state.kind === "exporting"}
                  onChange={setPeriod}
                  value={period}
                />
                {period === "custom" ? (
                  <DateRange
                    disabled={state.kind === "exporting"}
                    error={error}
                    from={range.from}
                    onChange={setRange}
                    to={range.to}
                  />
                ) : null}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {PERIOD_LABELS[period]}
              </span>
            )
          }
        >
          {canExport ? (
            <ExportControls
              doneLabel="Downloaded"
              onExport={exportRuns}
              state={state}
            />
          ) : null}
        </SettingsRow>
      </SettingsRows>
      {canExport ? null : (
        <p className="px-5 text-caption text-muted-foreground">
          {DEVELOPERS_ONLY}
        </p>
      )}
    </SettingsSection>
  );
}

// A Custom range's end date counts the whole day: cases created before the
// next day's start.
function nextDay(value: string) {
  if (!value) return undefined;
  const date = new Date(value + "T00:00:00");
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function NewDatasetDialog({
  agentSlug,
  open,
  onOpenChange,
}: {
  agentSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <SettingsDialog
      content={(close) => (
        <NewDatasetForm agentSlug={agentSlug} close={close} />
      )}
      description="Next, pick which cases it includes. You can change the query any time."
      onOpenChange={onOpenChange}
      open={open}
      title="New dataset"
    />
  );
}

export const nameTaken = (name: string) =>
  "This agent already has a dataset named " + name + ".";

/** Name validation: required, and not a name the API refused as taken. */
export function nameValidator(taken: Set<string>) {
  return (value: string) =>
    !value.trim()
      ? "Name the dataset."
      : taken.has(value.trim())
        ? nameTaken(value.trim())
        : null;
}

function NewDatasetForm({
  agentSlug,
  close,
}: {
  agentSlug: string;
  close: () => void;
}) {
  const navigate = useNavigate();
  const { create } = useDatasetWrites(agentSlug);
  const nameRef = useRef<ValidatedFieldHandle>(null);
  const [name, setName] = useState("");
  const [taken, setTaken] = useState(() => new Set<string>());
  // A name the API refused shows its error once validation knows it.
  useEffect(() => {
    if (taken.size) nameRef.current?.commit();
  }, [taken]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    setError(null);
    if (!nameRef.current?.commit()) throw new AsyncActionAbortError();
    try {
      const id = await create(name.trim());
      close();
      await navigate({
        to: "/agents/$agentId/training/datasets/$datasetId",
        params: { agentId: agentSlug, datasetId: id },
      });
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
        id="dataset-name"
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
          onAction={onCreate}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Creating…"
          type="button"
        >
          Create dataset
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}
