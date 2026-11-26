import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  AsyncActionAbortError,
  LoadingButton,
} from "@preprocess/ui/components/loading-button";
import { ChevronRight, Plus } from "@preprocess/ui/lib/icons";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";

import { orgApi } from "../auth/client";
import {
  SettingsDialog,
  SettingsDialogActions,
  SettingsEmpty,
  SettingsError,
  SettingsPanelMessage,
  SettingsRowSkeleton,
  SettingsRows,
  SettingsSection,
  actionErrorMessage,
  formatRelative,
} from "../settings/kit";
import { RUN_STATUS, formatRate, useOrgJson, type EvalSuite } from "./eval-api";
import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";

const countFormat = new Intl.NumberFormat();

function suiteSummary(suite: EvalSuite) {
  const cases = `${countFormat.format(suite.cases)} ${suite.cases === 1 ? "case" : "cases"}`;
  return suite.kind === "automatic"
    ? `Automatic · ${cases}, keeps the newest ${countFormat.format(suite.cap ?? 0)}`
    : `Manual · ${cases}`;
}

/** An agent's eval suites, the automatic one first. */
export function AgentEvalSuites({
  agentSlug,
}: Readonly<{ agentSlug: string }>) {
  const { state, organizationId } = useOrgJson<{ suites: EvalSuite[] }>(
    `/agents/${encodeURIComponent(agentSlug)}/eval-suites`,
  );
  const navigate = useNavigate();

  return (
    <SettingsSection
      actions={
        state.kind === "ready" ? (
          <SettingsDialog
            description="A suite you fill with chosen cases. The automatic suite already collects this agent's completed cases."
            title="New suite"
            content={(close) => (
              <NewSuiteForm
                close={close}
                onCreate={async (input) => {
                  const suite = await orgApi<EvalSuite>(
                    organizationId,
                    `/agents/${encodeURIComponent(agentSlug)}/eval-suites`,
                    { method: "POST", body: JSON.stringify(input) },
                  );
                  await navigate({
                    to: "/agents/$agentId/evaluations/$suiteId",
                    params: { agentId: agentSlug, suiteId: suite.id },
                  });
                }}
              />
            )}
          >
            <Button leadingIcon={Plus} type="button" variant="secondary">
              New suite
            </Button>
          </SettingsDialog>
        ) : null
      }
      description="Suites of finished cases replayed against a deployment and scored field by field, so a change that makes answers worse shows up. Results are informational."
      title="Evaluations"
    >
      {state.kind === "loading" ? (
        <SettingsRows>
          <SettingsRowSkeleton label="Automatic" />
          <SettingsRowSkeleton label="Suite" />
        </SettingsRows>
      ) : state.kind === "missing" ? (
        <SettingsEmpty
          description="The automatic suite starts collecting cases once this agent is deployed and finishes one."
          title="No evaluations yet"
        />
      ) : state.kind === "failed" ? (
        <SettingsError error={state.error} />
      ) : state.data.suites.length === 0 ? (
        <SettingsEmpty
          description="The automatic suite starts collecting cases once this agent finishes one."
          title="No suites yet"
        />
      ) : (
        <SettingsRows>
          {state.data.suites.map((suite) => (
            <Link
              className="flex min-h-16 items-center gap-4 px-5 py-3 outline-none hover:bg-hover focus-visible:bg-hover"
              key={suite.id}
              params={{ agentId: agentSlug, suiteId: suite.id }}
              to="/agents/$agentId/evaluations/$suiteId"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-body text-foreground">
                  {suite.name}
                </span>
                <span className="truncate text-caption text-muted-foreground">
                  {suiteSummary(suite)}
                </span>
              </div>
              <LatestRun suite={suite} />
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
  );
}

function LatestRun({ suite }: Readonly<{ suite: EvalSuite }>) {
  const run = suite.latestRun;
  if (!run)
    return (
      <span className="text-caption text-muted-foreground">Never run</span>
    );
  const status = RUN_STATUS[run.status];
  return (
    <div className="flex shrink-0 items-center gap-3">
      <span className="text-caption text-muted-foreground">
        {formatRelative(run.createdAt)}
      </span>
      {run.status === "completed" ? (
        <span className="text-body text-foreground tabular-nums">
          {formatRate(run.passRate)} passed
        </span>
      ) : (
        <Badge color={status.color}>{status.label}</Badge>
      )}
    </div>
  );
}

function validateName(value: string) {
  return value.trim() ? null : "Name the suite.";
}

function NewSuiteForm({
  close,
  onCreate,
}: Readonly<{
  close: () => void;
  onCreate: (input: { name: string }) => Promise<void>;
}>) {
  const nameRef = useRef<ValidatedFieldHandle>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    if (!nameRef.current?.commit()) throw new AsyncActionAbortError();
    try {
      await onCreate({ name: name.trim() });
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not create the suite."));
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
        id="eval-suite-name"
        label="Name"
        onChange={setName}
        placeholder="Renewal packs"
        validate={validateName}
        value={name}
      />
      {error ? (
        <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
      ) : null}
      <SettingsDialogActions onCancel={close} pending={pending}>
        <LoadingButton
          onAction={onSave}
          onStatusChange={(status) => setPending(status === "pending")}
          pendingLabel="Creating…"
          successLabel="Created"
          type="button"
        >
          Create suite
        </LoadingButton>
      </SettingsDialogActions>
    </form>
  );
}
