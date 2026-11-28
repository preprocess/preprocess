"use client";

// Settings › Developers › Models (PRE-145): the built-in models every agent
// can run on, and the organization's own models, each served by an endpoint
// it registered. Owners and Admins register, test, edit and delete
// endpoints; everyone else reads. Which models are allowed stays in
// Guardrails.

import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@preprocess/ui/components/field";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@preprocess/ui/components/table";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { Link } from "@tanstack/react-router";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  CouldntLoadArt,
  CustomModelsArt,
  NoAccessArt,
} from "../../components/empty-art";
import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";
import { ApiError } from "../auth/client";
import {
  SettingsCard,
  SettingsConfirmDialog,
  SettingsDialogActions,
  SettingsDialogShell,
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
  ModelInUseError,
  servesOwnBuiltIns,
  slugOf,
  useManagesModels,
  useModelActions,
  useModels,
  type CatalogModel,
  type ModelEntry,
  type ModelUse,
  type OrgModel,
  type TestResult,
} from "./models-api";

type Outcome = { ok: boolean; text: string };

function testOutcome(result: TestResult, providerModel: string): Outcome {
  if (result.ok)
    return { ok: true, text: `Responded in ${result.latencyMs} ms.` };
  const reason =
    result.reason ?? (result.status === null ? "unreachable" : "http");
  switch (reason) {
    case "unauthorized":
      return {
        ok: false,
        text: `The endpoint answered ${result.status === 403 ? "403 Forbidden" : "401 Unauthorized"}. Check the API key.`,
      };
    case "timeout":
      return {
        ok: false,
        text: "The endpoint timed out. Check that it's running and reachable.",
      };
    case "unreachable":
      return {
        ok: false,
        text: "Couldn't reach the URL. Check the address and network rules.",
      };
    case "model_not_found":
      return {
        ok: false,
        text: `Model "${providerModel}" wasn't found on this endpoint. Check the model name.`,
      };
    case "http":
      return {
        ok: false,
        text: `The endpoint answered ${result.status}. Check the endpoint logs.`,
      };
  }
}

/** A row of the Can't delete dialog: what still names the model. */
function describeUse(use: ModelUse) {
  switch (use.type) {
    case "deployment":
      return {
        key: `deployment:${use.deploymentId}`,
        label: use.agentName,
        description: `${use.production ? "Production" : "Preview"} deployment ${use.deploymentId}`,
      };
    case "settings":
      return {
        key: `settings:${use.agentId}`,
        label: use.agentName,
        description: "Agent settings",
      };
    case "organization_default":
      return {
        key: "organization_default",
        label: "Defaults",
        description: "Organization default model",
      };
    case "eval_suite":
      return {
        key: `suite:${use.suiteId}`,
        label: use.suiteName,
        description: "Eval suite",
      };
  }
}

function Strong({ children }: { children: ReactNode }) {
  return (
    <span
      className="truncate text-body text-foreground"
      style={{ fontVariationSettings: fontWeights.medium }}
    >
      {children}
    </span>
  );
}

function Mono({ children }: { children: string }) {
  return (
    <span
      className="block truncate font-mono text-caption text-muted-foreground"
      title={children}
    >
      {children}
    </span>
  );
}

function AllowedBadge({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <Badge color="green" size="compact" variant="dot">
      Allowed
    </Badge>
  ) : (
    <Badge color="gray" size="compact" variant="dot">
      Not allowed
    </Badge>
  );
}

function TestLine({ outcome }: { outcome: Outcome }) {
  return (
    <span className="flex items-start gap-1.5 whitespace-normal">
      <Badge
        className="shrink-0"
        color={outcome.ok ? "green" : "red"}
        size="compact"
        variant="dot"
      >
        {outcome.ok ? "Works" : "Failed"}
      </Badge>
      <span
        className={
          outcome.ok
            ? "text-caption text-muted-foreground"
            : "text-caption text-destructive"
        }
      >
        {outcome.text}
      </span>
    </span>
  );
}

function LoadingSection({ title, rows }: { title: string; rows: number }) {
  return (
    <SettingsSection title={title}>
      <SettingsRows>
        {Array.from({ length: rows }, (_, index) => (
          <SettingsRowSkeleton description={220} key={index} label={120} />
        ))}
      </SettingsRows>
    </SettingsSection>
  );
}

export function ModelsPanel() {
  const models = useModels();
  const manage = useManagesModels() === true;

  if (models.isError)
    return models.error instanceof ApiError && models.error.status === 403 ? (
      <SettingsEmpty
        art={<NoAccessArt />}
        description="Ask an organization Owner or Admin if you need access to this section."
        title="You don't have access"
      />
    ) : (
      <SettingsEmpty
        action={
          <Button
            onClick={() => void models.refetch()}
            size="sm"
            type="button"
            variant="secondary"
          >
            Try again
          </Button>
        }
        art={<CouldntLoadArt />}
        description="Something went wrong loading models. Try again."
        title="Couldn't load models"
      />
    );
  if (!models.data)
    return (
      <SettingsStacked>
        <LoadingSection rows={4} title="Built-in models" />
        <LoadingSection rows={2} title="Your models" />
      </SettingsStacked>
    );
  return <Loaded manage={manage} models={models.data} />;
}

type Editing =
  | { mode: "register" }
  | { mode: "edit"; model: OrgModel }
  | { mode: "serve"; model: CatalogModel };

function Loaded({
  models,
  manage,
}: {
  models: readonly ModelEntry[];
  manage: boolean;
}) {
  const actions = useModelActions();
  const builtIns = models.filter(
    (m): m is CatalogModel => m.kind === "catalog",
  );
  const own = models.filter((m): m is OrgModel => m.kind === "model");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [tests, setTests] = useState<ReadonlyMap<string, Outcome>>(new Map());
  const [deleting, setDeleting] = useState<OrgModel | null>(null);
  const [blocked, setBlocked] = useState<{
    model: OrgModel;
    usedBy: ModelUse[];
  } | null>(null);

  const forget = (id: string) =>
    setTests((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });

  async function test(model: ModelEntry) {
    if (!model.endpoint) return;
    const result = await actions.test(model.endpoint.id);
    setTests((current) =>
      new Map(current).set(
        model.id,
        testOutcome(result, model.endpoint!.providerModel),
      ),
    );
  }

  const testButton = (model: ModelEntry) => (
    <LoadingButton
      className="w-auto shrink-0"
      errorLabel="Test"
      onAction={() => test(model)}
      size="compact"
      successLabel="Test"
      variant="secondary"
    >
      Test
    </LoadingButton>
  );

  const startDelete = (model: OrgModel) =>
    model.usedBy?.length
      ? setBlocked({ model, usedBy: model.usedBy })
      : setDeleting(model);

  return (
    <>
      <SettingsStacked>
        <BuiltInSection
          manage={manage}
          models={builtIns}
          onEdit={(model) => setEditing({ mode: "serve", model })}
          selfHosted={servesOwnBuiltIns(models)}
          testButton={testButton}
          tests={tests}
        />
        <OwnSection
          builtIns={builtIns}
          manage={manage}
          models={own}
          onDelete={startDelete}
          onEdit={(model) => setEditing({ mode: "edit", model })}
          onRegister={() => setEditing({ mode: "register" })}
          testButton={testButton}
          tests={tests}
        />
      </SettingsStacked>
      {editing ? (
        <EndpointDialog
          builtIns={builtIns}
          editing={editing}
          key={editing.mode === "register" ? "register" : editing.model.id}
          labels={own
            .filter((m) => editing.mode !== "edit" || m.id !== editing.model.id)
            .map((m) => m.label)}
          onOpenChange={(open) => (open ? undefined : setEditing(null))}
          onSaved={(id) => forget(id)}
        />
      ) : null}
      <SettingsConfirmDialog
        confirmLabel="Delete"
        description="Agents can no longer run on it. Your endpoint and its weights aren't touched."
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await actions.remove(deleting.endpoint.id);
            forget(deleting.id);
          } catch (cause) {
            if (!(cause instanceof ModelInUseError)) throw cause;
            setBlocked({ model: deleting, usedBy: cause.usedBy });
            setDeleting(null);
            throw new AsyncActionAbortError();
          }
        }}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        open={deleting !== null}
        pendingLabel="Deleting…"
        successLabel="Deleted"
        title={`Delete ${deleting?.label ?? ""}?`}
      />
      {blocked ? (
        <SettingsDialogShell
          description="This model is still in use. Switch these to another model first, then delete it."
          footer={
            <Button
              onClick={() => setBlocked(null)}
              type="button"
              variant="secondary"
            >
              Close
            </Button>
          }
          onOpenChange={(open) => (open ? undefined : setBlocked(null))}
          open
          title={`Can't delete ${blocked.model.label}`}
        >
          <div className="flex flex-col divide-y divide-border">
            {blocked.usedBy.map((use) => {
              const row = describeUse(use);
              return (
                <SettingsRow
                  description={row.description}
                  key={row.key}
                  label={row.label}
                />
              );
            })}
          </div>
        </SettingsDialogShell>
      ) : null}
    </>
  );
}

function BuiltInSection({
  models,
  manage,
  selfHosted,
  tests,
  testButton,
  onEdit,
}: {
  models: readonly CatalogModel[];
  manage: boolean;
  selfHosted: boolean;
  tests: ReadonlyMap<string, Outcome>;
  testButton: (model: ModelEntry) => ReactNode;
  onEdit: (model: CatalogModel) => void;
}) {
  const serves = manage && selfHosted;
  const name = (model: CatalogModel) => (
    <span className="flex min-w-0 items-center gap-2">
      <Strong>{model.label}</Strong>
      {model.isDefault ? <Badge size="compact">Default</Badge> : null}
    </span>
  );
  const servedBy = (model: CatalogModel) =>
    model.endpoint || model.serving === "install"
      ? "Your endpoint"
      : "Preprocess";
  const actions = (model: CatalogModel) =>
    servedBy(model) === "Preprocess" ? (
      <span className="flex items-center justify-end">
        <SettingsRowMenu
          actions={[
            {
              label: "Serve from your endpoint",
              onSelect: () => onEdit(model),
            },
          ]}
          label={`Actions for ${model.label}`}
        />
      </span>
    ) : model.endpoint ? (
      <span className="flex items-center justify-end gap-1">
        {testButton(model)}
        <SettingsRowMenu
          actions={[{ label: "Edit", onSelect: () => onEdit(model) }]}
          label={`Actions for ${model.label}`}
        />
      </span>
    ) : null;
  return (
    <SettingsSection
      actions={
        manage ? (
          <Button asChild size="compact" variant="secondary">
            <Link hash="models" to="/settings/organization/guardrails">
              Manage in Guardrails
            </Link>
          </Button>
        ) : null
      }
      description="Every agent can run on these, billed per token. Guardrails decide which ones are allowed."
      title="Built-in models"
    >
      <div className="hidden sm:block">
        <SettingsCard table>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="w-44">Served by</TableHead>
                <TableHead className="w-32">Allowed</TableHead>
                {serves ? (
                  <TableHead className="w-24">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.flatMap((model, index) => {
                const outcome = tests.get(model.id);
                return [
                  <TableRow index={index} key={model.id}>
                    <TableCell className="max-w-0">
                      <div className="flex min-w-0 flex-col gap-0.5 py-2">
                        {name(model)}
                        <Mono>{model.id}</Mono>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-0">
                      {model.endpoint ? (
                        <span className="flex min-w-0 flex-col">
                          <span>Your endpoint</span>
                          <Mono>{model.endpoint.host}</Mono>
                        </span>
                      ) : (
                        servedBy(model)
                      )}
                    </TableCell>
                    <TableCell>
                      <AllowedBadge allowed={model.allowed} />
                    </TableCell>
                    {serves ? (
                      <TableCell className="text-right">
                        {actions(model)}
                      </TableCell>
                    ) : null}
                  </TableRow>,
                  outcome ? (
                    <TableRow key={`${model.id}-test`}>
                      <TableCell
                        className="whitespace-normal border-t-0 pt-0 pb-4"
                        colSpan={serves ? 4 : 3}
                      >
                        <TestLine outcome={outcome} />
                      </TableCell>
                    </TableRow>
                  ) : null,
                ];
              })}
            </TableBody>
          </Table>
        </SettingsCard>
      </div>
      <div className="sm:hidden">
        <SettingsRows>
          {models.map((model) => {
            const outcome = tests.get(model.id);
            return (
              <div className="flex flex-col gap-1.5 px-5 py-3" key={model.id}>
                {name(model)}
                <Mono>{model.id}</Mono>
                {outcome ? <TestLine outcome={outcome} /> : null}
                <span className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                  {model.endpoint
                    ? `Your endpoint · ${model.endpoint.host}`
                    : servedBy(model)}
                  <AllowedBadge allowed={model.allowed} />
                </span>
                {serves ? (
                  <span className="flex pt-1">{actions(model)}</span>
                ) : null}
              </div>
            );
          })}
        </SettingsRows>
      </div>
    </SettingsSection>
  );
}

function OwnSection({
  models,
  builtIns,
  manage,
  tests,
  testButton,
  onRegister,
  onEdit,
  onDelete,
}: {
  models: readonly OrgModel[];
  builtIns: readonly CatalogModel[];
  manage: boolean;
  tests: ReadonlyMap<string, Outcome>;
  testButton: (model: ModelEntry) => ReactNode;
  onRegister: () => void;
  onEdit: (model: OrgModel) => void;
  onDelete: (model: OrgModel) => void;
}) {
  const empty = models.length === 0;
  const baseLabel = (model: OrgModel) =>
    model.baseModel === null
      ? null
      : (builtIns.find((m) => m.id === model.baseModel)?.label ??
        model.baseModel);
  const actions = (model: OrgModel) => (
    <span className="flex items-center justify-end gap-1">
      {testButton(model)}
      <SettingsRowMenu
        actions={[
          { label: "Edit", onSelect: () => onEdit(model) },
          { label: "Delete", onSelect: () => onDelete(model) },
        ]}
        label={`Actions for ${model.label}`}
      />
    </span>
  );
  const name = (model: OrgModel) => (
    <div className="flex min-w-0 flex-col gap-0.5 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <Strong>{model.label}</Strong>
        {model.isDefault ? <Badge size="compact">Default</Badge> : null}
      </span>
      <Mono>{model.id}</Mono>
    </div>
  );
  const register = (size: "compact" | "sm") => (
    <Button onClick={onRegister} size={size} type="button" variant="secondary">
      Register endpoint
    </Button>
  );
  return (
    <SettingsSection
      actions={manage && !empty ? register("compact") : null}
      description="Models you serve yourself, such as a fine-tune, added by their endpoint. Agents that use one send case data to it."
      title="Your models"
    >
      {empty ? (
        <SettingsEmpty
          action={manage ? register("sm") : undefined}
          art={<CustomModelsArt />}
          description={
            manage
              ? "Register a model you serve, such as one trained on your cases, by its endpoint URL."
              : "Owners and Admins can register a model you serve by its endpoint URL."
          }
          title="No custom models yet"
        />
      ) : (
        <>
          <div className="hidden sm:block">
            <SettingsCard table>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead className="w-40">Endpoint</TableHead>
                    <TableHead className="w-36">Base model</TableHead>
                    <TableHead className="w-28">Allowed</TableHead>
                    {manage ? (
                      <TableHead className="w-24">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.flatMap((model, index) => {
                    const outcome = tests.get(model.id);
                    return [
                      <TableRow index={index} key={model.id}>
                        <TableCell className="max-w-0 whitespace-normal">
                          {name(model)}
                        </TableCell>
                        <TableCell className="max-w-0">
                          <Mono>{model.endpoint.host}</Mono>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {baseLabel(model) ?? (
                            <span className="text-muted-foreground">None</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <AllowedBadge allowed={model.allowed} />
                        </TableCell>
                        {manage ? (
                          <TableCell>{actions(model)}</TableCell>
                        ) : null}
                      </TableRow>,
                      outcome ? (
                        <TableRow key={`${model.id}-test`}>
                          <TableCell
                            className="whitespace-normal border-t-0 pt-0 pb-4"
                            colSpan={manage ? 5 : 4}
                          >
                            <TestLine outcome={outcome} />
                          </TableCell>
                        </TableRow>
                      ) : null,
                    ];
                  })}
                </TableBody>
              </Table>
            </SettingsCard>
          </div>
          <div className="sm:hidden">
            <SettingsRows>
              {models.map((model) => {
                const outcome = tests.get(model.id);
                return (
                  <div
                    className="flex flex-col gap-1.5 px-5 py-3"
                    key={model.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      {name(model)}
                      {manage ? (
                        <span className="pt-1.5">{actions(model)}</span>
                      ) : null}
                    </div>
                    {outcome ? <TestLine outcome={outcome} /> : null}
                    <span className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                      {`${model.endpoint.host} · ${baseLabel(model) ?? "No base model"}`}
                      <AllowedBadge allowed={model.allowed} />
                    </span>
                  </div>
                );
              })}
            </SettingsRows>
          </div>
        </>
      )}
      {manage || empty ? null : (
        <p className="px-5 text-caption text-muted-foreground">
          Only Owners and Admins can register, test or delete endpoints.
        </p>
      )}
    </SettingsSection>
  );
}

const NO_BASE = "none";

function validateUrl(value: string) {
  try {
    return new URL(value.trim()).protocol === "https:"
      ? null
      : "Use an https:// URL.";
  } catch {
    return "Use an https:// URL.";
  }
}

/** Registers an endpoint, or edits one: an organization model's or a built-in's. */
function EndpointDialog({
  editing,
  builtIns,
  labels,
  onOpenChange,
  onSaved,
}: {
  editing: Editing;
  builtIns: readonly CatalogModel[];
  /** Names other organization models already have. */
  labels: readonly string[];
  onOpenChange: (open: boolean) => void;
  onSaved: (modelId: string) => void;
}) {
  const actions = useModelActions();
  const model = editing.mode === "register" ? null : editing.model;
  const endpoint = model?.endpoint ?? null;
  const own = editing.mode !== "serve";
  const initialUrl = endpoint ? `https://${endpoint.host}` : "";
  const nameRef = useRef<ValidatedFieldHandle>(null);
  const urlRef = useRef<ValidatedFieldHandle>(null);
  const providerRef = useRef<ValidatedFieldHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [label, setLabel] = useState(model?.label ?? "");
  const [url, setUrl] = useState(initialUrl);
  const [providerModel, setProviderModel] = useState(
    endpoint?.providerModel ??
      (editing.mode === "serve" ? editing.model.id : ""),
  );
  const [key, setKey] = useState("");
  const [baseModel, setBaseModel] = useState(
    editing.mode === "edit" ? (editing.model.baseModel ?? NO_BASE) : NO_BASE,
  );
  const [checkpoint, setCheckpoint] = useState(
    editing.mode === "edit" ? (editing.model.checkpoint ?? "") : "",
  );
  const [taken, setTaken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editingExisting = endpoint !== null;

  async function save() {
    setError(null);
    const valid = [
      nameRef.current?.commit() ?? true,
      urlRef.current?.commit(),
      providerRef.current?.commit(),
    ];
    if (!valid.every(Boolean)) throw new AsyncActionAbortError();
    const trimmed = label.trim();
    const optional = own
      ? {
          baseModel: baseModel === NO_BASE ? null : baseModel,
          checkpoint: checkpoint.trim() || null,
        }
      : {};
    try {
      if (endpoint && model) {
        await actions.update(endpoint.id, {
          ...(own ? { label: trimmed } : {}),
          ...(url.trim() !== initialUrl ? { url: url.trim() } : {}),
          providerModel: providerModel.trim(),
          ...(key ? { key } : {}),
          ...optional,
        });
        onSaved(model.id);
      } else {
        const id = model ? model.id : `org:${slugOf(trimmed)}`;
        await actions.register({
          model: id,
          ...(own ? { label: trimmed } : {}),
          url: url.trim(),
          providerModel: providerModel.trim(),
          ...(key ? { key } : {}),
          ...optional,
        });
        onSaved(id);
      }
      window.setTimeout(() => onOpenChange(false), 400);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "endpoint_exists") {
        setTaken(trimmed);
        nameRef.current?.commit();
        throw new AsyncActionAbortError();
      }
      setError(actionErrorMessage(cause, "Something went wrong. Try again."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      description={
        editingExisting
          ? "Changes apply to cases that start from now on."
          : "Agents that use this model send case data to the endpoint."
      }
      onOpenChange={onOpenChange}
      open
      size="lg"
      title={
        editingExisting && model ? `Edit ${model.label}` : "Register endpoint"
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        {own ? (
          <ValidatedField
            autoFocus
            hint="Shown wherever a model is picked."
            id="model-name"
            label="Name"
            onChange={(value) => {
              setLabel(value);
              setTaken(null);
            }}
            ref={nameRef}
            validate={(value) => {
              const trimmed = value.trim();
              if (!trimmed || !slugOf(trimmed)) return "Enter a name.";
              return labels.some(
                (l) => l.toLowerCase() === trimmed.toLowerCase(),
              ) || taken === trimmed
                ? `A model named ${trimmed} already exists.`
                : null;
            }}
            value={label}
          />
        ) : (
          <ValidatedField
            disabled
            hint="Shown wherever a model is picked."
            id="model-name"
            label="Name"
            onChange={() => undefined}
            validate={() => null}
            value={editing.model.label}
          />
        )}
        <ValidatedField
          hint="An OpenAI-compatible base URL."
          id="model-url"
          label="Endpoint URL"
          onChange={setUrl}
          placeholder="https://models.example.com/v1"
          ref={urlRef}
          type="url"
          validate={validateUrl}
          value={url}
        />
        <ValidatedField
          hint="Sent as the model in every request."
          id="model-provider-model"
          label="Model name"
          onChange={setProviderModel}
          ref={providerRef}
          validate={(value) =>
            value.trim() ? null : "Enter the model name the endpoint expects."
          }
          value={providerModel}
        />
        <ValidatedField
          autoComplete="off"
          hint={
            endpoint?.hasKey
              ? "A key is saved. Leave this empty to keep it."
              : "Stored encrypted. You can replace it later, but not view it."
          }
          id="model-key"
          label="API key"
          onChange={setKey}
          placeholder={endpoint?.hasKey ? "Saved key" : undefined}
          type="password"
          validate={() => null}
          value={key}
        />
        {own ? (
          <>
            <div className="-mx-6 border-t border-border/60" />
            <Field>
              <FieldLabel>
                Base model
                <span className="text-muted-foreground"> (optional)</span>
              </FieldLabel>
              <Select onValueChange={setBaseModel} value={baseModel}>
                <SelectTrigger aria-label="Base model" />
                <SelectContent>
                  {[{ id: NO_BASE, label: "None" }, ...builtIns].map(
                    (option, index) => (
                      <SelectItem
                        index={index}
                        key={option.id}
                        value={option.id}
                      >
                        {option.label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <FieldDescription>
                The built-in model it was trained from. For your records; models
                on your endpoint have no model charge.
              </FieldDescription>
            </Field>
            <ValidatedField
              hint="Where the weights came from, such as a training run or a repository. For your records."
              id="model-checkpoint"
              label="Checkpoint source (optional)"
              onChange={setCheckpoint}
              placeholder="runs/renewals/step-400"
              validate={() => null}
              value={checkpoint}
            />
          </>
        ) : null}
        {error ? (
          <SettingsPanelMessage tone="danger">{error}</SettingsPanelMessage>
        ) : null}
        <SettingsDialogActions
          onCancel={() => onOpenChange(false)}
          pending={pending}
        >
          <LoadingButton
            onAction={save}
            onStatusChange={(status) => setPending(status === "pending")}
            pendingLabel={editingExisting ? "Saving…" : "Registering…"}
            ref={saveRef}
            successLabel={editingExisting ? "Saved" : "Registered"}
            type="submit"
          >
            {editingExisting ? "Save" : "Register"}
          </LoadingButton>
        </SettingsDialogActions>
      </form>
    </SettingsDialogShell>
  );
}
