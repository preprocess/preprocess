import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  CheckboxGroup,
  CheckboxItem,
} from "@preprocess/ui/components/checkbox-group";
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
import { Switch } from "@preprocess/ui/components/switch";
import { ChevronRight, Play, XIcon } from "@preprocess/ui/lib/icons";
import { MODELS } from "@preprocess/sdk/protocol";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";

import { orgApi } from "../auth/client";
import {
  SettingsConfirmBody,
  SettingsDialog,
  SettingsDialogActions,
  SettingsEmpty,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRows,
  SettingsSection,
  actionErrorMessage,
  formatRelative,
} from "../settings/kit";
import {
  RUN_STATUS,
  formatRate,
  formatUsd,
  inputText,
  shortId,
  useOrgJson,
  type AgentDeploymentSummary,
  type EvalRun,
  type EvalSuiteDetail,
} from "./eval-api";
import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";

const countFormat = new Intl.NumberFormat();
const moving = (run: EvalRun) =>
  run.status === "queued" || run.status === "running";

export function runCounts(run: EvalRun) {
  return [
    `${countFormat.format(run.passed)} passed`,
    `${countFormat.format(run.neededPerson)} needed a person`,
    `${countFormat.format(run.failed)} failed`,
  ].join(" · ");
}

/** The run's outcome: its pass rate once done, else its status. */
export function RunOutcome({ run }: Readonly<{ run: EvalRun }>) {
  if (run.status === "completed")
    return (
      <span className="text-body text-foreground tabular-nums">
        {formatRate(run.passRate)} passed
      </span>
    );
  const status = RUN_STATUS[run.status];
  return <Badge color={status.color}>{status.label}</Badge>;
}

/**
 * One suite: its runs (newest first, refreshing while one is in progress),
 * the latest deployment's models side by side, its cases, and its settings.
 */
export function EvalSuiteView({
  agentSlug,
  suite,
  organizationId,
  reload,
}: Readonly<{
  agentSlug: string;
  suite: EvalSuiteDetail;
  organizationId: string;
  reload: () => void;
}>) {
  const navigate = useNavigate();
  const patch = (body: object) =>
    orgApi(organizationId, `/eval-suites/${suite.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then(reload);

  return (
    <>
      <SettingsSection
        actions={
          <SettingsDialog
            description="Replays every case in the suite against a deployment, once per model, and scores the answers field by field."
            title="Run suite"
            content={(close) => (
              <RunSuiteForm
                agentSlug={agentSlug}
                close={close}
                onRun={async (input) => {
                  await orgApi(
                    organizationId,
                    `/eval-suites/${suite.id}/runs`,
                    { method: "POST", body: JSON.stringify(input) },
                  );
                  reload();
                  close();
                }}
              />
            )}
          >
            <Button
              disabled={suite.cases === 0}
              leadingIcon={Play}
              type="button"
            >
              Run suite
            </Button>
          </SettingsDialog>
        }
        description={
          suite.kind === "automatic"
            ? `Collects this agent's completed cases and keeps the newest ${countFormat.format(suite.cap ?? 0)}.`
            : "Cases chosen for this suite."
        }
        title="Runs"
      >
        {suite.runs.length === 0 ? (
          <SettingsEmpty
            description={
              suite.cases === 0
                ? "Add cases to the suite, then run it against a deployment."
                : "Run the suite to score a deployment against these cases."
            }
            title="No runs yet"
          />
        ) : (
          <SettingsRows>
            {suite.runs.map((run) => (
              <Link
                className="flex min-h-16 items-center gap-4 px-5 py-3 outline-none hover:bg-hover focus-visible:bg-hover"
                key={run.id}
                params={{
                  agentId: agentSlug,
                  suiteId: suite.id,
                  runId: run.id,
                }}
                to="/agents/$agentId/evaluations/$suiteId/runs/$runId"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-body text-foreground">
                    {run.model} on {shortId(run.deploymentId)}
                  </span>
                  <span className="truncate text-caption text-muted-foreground">
                    {runCounts(run)} · {formatUsd(run.costUsd)} ·{" "}
                    {run.trigger === "push" ? "On deployment" : "Manual"}
                  </span>
                </div>
                <span className="shrink-0 text-caption text-muted-foreground">
                  {formatRelative(run.createdAt)}
                </span>
                <RunOutcome run={run} />
                <ChevronRight
                  aria-hidden="true"
                  className="shrink-0 text-muted-foreground"
                  size={16}
                />
              </Link>
            ))}
          </SettingsRows>
        )}
      </SettingsSection>
      <ModelComparison runs={suite.runs} />
      <SettingsSection
        description="Each case's original input and the answers a person confirmed, which runs are scored against."
        title={`Cases (${countFormat.format(suite.cases)})`}
      >
        {suite.suiteCases.length === 0 ? (
          <SettingsEmpty
            description={
              suite.kind === "automatic"
                ? "Completed cases of this agent land here."
                : "Add completed cases with the API or the CLI."
            }
            title="No cases"
          />
        ) : (
          <SettingsRows>
            {suite.suiteCases.map((item) => (
              <SettingsRow
                description={`Added ${formatRelative(item.addedAt)} · ${item.caseId}`}
                key={item.caseId}
                label={inputText(item.input)}
              >
                <Button
                  aria-label="Remove from suite"
                  onClick={() =>
                    void orgApi(
                      organizationId,
                      `/eval-suites/${suite.id}/cases`,
                      {
                        method: "DELETE",
                        body: JSON.stringify({ cases: [item.caseId] }),
                      },
                    ).finally(reload)
                  }
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <XIcon size={16} />
                </Button>
              </SettingsRow>
            ))}
          </SettingsRows>
        )}
      </SettingsSection>
      <SettingsSection title="Settings">
        <SettingsRows>
          <SettingsRow
            description="When a new deployment of this agent is ready, run this suite against it."
            label="Run on each new deployment"
          >
            <Switch
              checked={suite.runOnPush}
              label={suite.runOnPush ? "On" : "Off"}
              onToggle={() => void patch({ runOnPush: !suite.runOnPush })}
            />
          </SettingsRow>
          <SettingsRow
            description={
              suite.kind === "automatic"
                ? `${suite.name} · keeps the newest ${countFormat.format(suite.cap ?? 0)} ${suite.cap === 1 ? "case" : "cases"}`
                : suite.name
            }
            label="Name and size"
          >
            <SettingsDialog
              title="Edit suite"
              content={(close) => (
                <EditSuiteForm
                  close={close}
                  onSave={async (body) => {
                    await patch(body);
                    close();
                  }}
                  suite={suite}
                />
              )}
            >
              <Button type="button" variant="secondary">
                Edit
              </Button>
            </SettingsDialog>
          </SettingsRow>
          {suite.kind === "manual" ? (
            <SettingsRow
              description="Its runs and results are deleted too."
              label="Delete suite"
            >
              <SettingsDialog
                description="This deletes the suite, its runs and their results. It can't be undone."
                title={`Delete ${suite.name}`}
                content={(close) => (
                  <SettingsConfirmBody
                    actionLabel="Delete"
                    onCancel={close}
                    onConfirm={async () => {
                      await orgApi(organizationId, `/eval-suites/${suite.id}`, {
                        method: "DELETE",
                      });
                      await navigate({
                        to: "/agents/$agentId/evaluations",
                        params: { agentId: agentSlug },
                      });
                    }}
                    pendingLabel="Deleting…"
                    successLabel="Deleted"
                  />
                )}
              >
                <Button type="button" variant="secondary">
                  Delete
                </Button>
              </SettingsDialog>
            </SettingsRow>
          ) : null}
        </SettingsRows>
      </SettingsSection>
    </>
  );
}

/**
 * The newest deployment's completed runs, one per model, side by side. Only
 * shown once that deployment has been run on more than one model.
 */
function ModelComparison({ runs }: Readonly<{ runs: readonly EvalRun[] }>) {
  const done = runs.filter((run) => run.status === "completed");
  const deployment = done[0]?.deploymentId;
  const latest = new Map<string, EvalRun>();
  for (const run of done)
    if (run.deploymentId === deployment && !latest.has(run.model))
      latest.set(run.model, run);
  if (latest.size < 2) return null;
  const rows = [...latest.values()].sort(
    (a, b) => (b.passRate ?? -1) - (a.passRate ?? -1),
  );
  return (
    <SettingsSection
      description={`The latest completed run of each model on deployment ${shortId(deployment)}.`}
      title="Models compared"
    >
      <SettingsRows>
        {rows.map((run) => (
          <SettingsRow
            description={`${runCounts(run)} · ${formatUsd(run.costUsd)}`}
            key={run.model}
            label={run.model}
          >
            <RunOutcome run={run} />
          </SettingsRow>
        ))}
      </SettingsRows>
    </SettingsSection>
  );
}

function RunSuiteForm({
  agentSlug,
  close,
  onRun,
}: Readonly<{
  agentSlug: string;
  close: () => void;
  onRun: (input: { deployment: string; models: string[] }) => Promise<void>;
}>) {
  const { state } = useOrgJson<AgentDeploymentSummary[]>(
    `/agents/${encodeURIComponent(agentSlug)}/deployments`,
  );
  const ready =
    state.kind === "ready"
      ? state.data.filter((deployment) => deployment.status === "ready")
      : [];
  const [chosen, setChosen] = useState<string | null>(null);
  const deployment =
    ready.find((d) => d.id === chosen) ??
    ready.find((d) => d.production) ??
    ready[0];
  const [models, setModels] = useState<string[] | null>(null);
  const picked = models ?? (deployment ? [deployment.model] : []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    if (!deployment) throw new AsyncActionAbortError();
    if (picked.length === 0) {
      setError("Pick at least one model.");
      throw new AsyncActionAbortError();
    }
    try {
      await onRun({ deployment: deployment.id, models: picked });
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not start the run."));
      throw cause;
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}
    >
      {state.kind === "ready" && ready.length === 0 ? (
        <SettingsPanelMessage tone="danger">
          This agent has no ready deployment to run against.
        </SettingsPanelMessage>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Deployment</span>
          <Select
            onValueChange={(next) => {
              setChosen(next);
              setModels(null);
            }}
            value={deployment?.id ?? ""}
          >
            <SelectTrigger aria-label="Deployment" className="w-full" />
            <SelectContent>
              {ready.map((d, index) => (
                <SelectItem index={index} key={d.id} value={d.id}>
                  {`${shortId(d.id)}${d.production ? " · Production" : ""}${d.git.branch ? ` · ${d.git.branch}` : ""}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-muted-foreground">
          Models, one run each
        </span>
        <CheckboxGroup
          checkedIndices={
            new Set(
              MODELS.flatMap((model, index) =>
                picked.includes(model) ? [index] : [],
              ),
            )
          }
        >
          {MODELS.map((model, index) => (
            <CheckboxItem
              checked={picked.includes(model)}
              index={index}
              key={model}
              label={
                deployment?.model === model
                  ? `${model} (the deployment's model)`
                  : model
              }
              onToggle={() =>
                setModels(
                  picked.includes(model)
                    ? picked.filter((m) => m !== model)
                    : [...picked, model],
                )
              }
            />
          ))}
        </CheckboxGroup>
      </div>
      {error ? (
        <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
      ) : null}
      <SettingsDialogActions onCancel={close} pending={pending}>
        <LoadingButton
          disabled={!deployment}
          onAction={onSave}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Starting…"
          successLabel="Started"
          type="button"
        >
          {picked.length > 1 ? `Start ${picked.length} runs` : "Start run"}
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}

function EditSuiteForm({
  suite,
  close,
  onSave,
}: Readonly<{
  suite: EvalSuiteDetail;
  close: () => void;
  onSave: (body: { name: string; cap?: number }) => Promise<void>;
}>) {
  const nameRef = useRef<ValidatedFieldHandle>(null);
  const capRef = useRef<ValidatedFieldHandle>(null);
  const [name, setName] = useState(suite.name);
  const [cap, setCap] = useState(String(suite.cap ?? ""));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const valid = [nameRef.current, capRef.current]
      .map((handle) => handle?.commit() ?? true)
      .every(Boolean);
    if (!valid) throw new AsyncActionAbortError();
    try {
      await onSave({
        name: name.trim(),
        ...(suite.kind === "automatic" && { cap: Number(cap) }),
      });
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not save the suite."));
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
        id="eval-suite-edit-name"
        label="Name"
        onChange={setName}
        validate={(value) => (value.trim() ? null : "Name the suite.")}
        value={name}
      />
      {suite.kind === "automatic" ? (
        <ValidatedField
          ref={capRef}
          hint="Older cases leave the suite when it's full. Lowering this removes them now."
          id="eval-suite-cap"
          inputMode="numeric"
          label="Cases to keep"
          onChange={setCap}
          validate={(value) =>
            /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 1000
              ? null
              : "Enter a number from 1 to 1,000."
          }
          value={cap}
        />
      ) : null}
      {error ? (
        <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
      ) : null}
      <SettingsDialogActions onCancel={close} pending={pending}>
        <LoadingButton
          onAction={save}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Saving…"
          successLabel="Saved"
          type="button"
        >
          Save
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}

export const suitePolls = (suite: EvalSuiteDetail) => suite.runs.some(moving);
