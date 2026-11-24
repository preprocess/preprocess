"use client";

// Connect, credential, rename, disconnect, and configure dialogs for data
// integrations. Ported from @workos-inc/widgets (MIT, Copyright (c) 2024
// WorkOS), src/widgets/pipes/pipes.tsx, pipes-connections.tsx and
// src/widgets/pipes-admin/pipes-admin.tsx.

import { Banner, BannerDescription } from "@preprocess/ui/components/banner";
import { Button } from "@preprocess/ui/components/button";
import {
  CheckboxGroup,
  CheckboxItem,
} from "@preprocess/ui/components/checkbox-group";
import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import { InputCopy } from "@preprocess/ui/components/input-copy";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { Switch } from "@preprocess/ui/components/switch";
import { Tooltip } from "@preprocess/ui/components/tooltip";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  Globe,
  InfoIcon,
  Lock,
  MoreHorizontalIcon,
  Plug,
  ShareUpRight,
} from "@preprocess/ui/lib/icons";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { ClientApiError } from "../../workos-client-api/graphql";
import {
  useWorkOsQuery,
  useWorkOsSdk,
  workOsKey,
} from "../../workos-client-api/sdk";
import type {
  ConnectDataProviderWithClientCredentialsMutation,
  ConnectOrganizationDataProviderWithClientCredentialsMutation,
  SetDataProviderConfigurationMutation,
  SetOrganizationDataProviderConfigurationMutation,
} from "../../workos-client-api/vendor/generated";
import {
  SettingsConfirmDialog,
  SettingsDialogShell,
  SettingsSearchField,
} from "../kit";
import type { ConnectHandler } from "./authorize";
import {
  configEntries,
  creationTargetInput,
  displayNameInput,
  isRedactedSecret,
  redactedSecret,
  useInvalidateConfiguration,
  useInvalidateConnections,
  validateConfigValue,
  type ConfigField,
  type ConfigurableIntegration,
  type Connection,
  type ConnectionOwner,
  type ConnectionTarget,
  type IconSource,
} from "./model";
import { PROVIDER_ICONS } from "./provider-icons";

/** Max label length the API accepts. */
const MAX_LABEL_LENGTH = 255;
const DUPLICATE_LABEL_WARNING = "duplicate_account_display_name";
const API_KEY_REDACTED_PREFIX = "••••";

// ── Shared parts ─────────────────────────────────────────

function safeHttpsUrl(url: string | null | undefined) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A provider's logo: a known WorkOS icon slug, then the provider's own icon
 * URLs, then its integration type, then a plug.
 */
export function ProviderLogo({
  integration,
  size = 16,
}: {
  integration: IconSource;
  size?: number;
}) {
  const bySlug = integration.iconSlug
    ? PROVIDER_ICONS[integration.iconSlug]
    : undefined;
  const customLight =
    safeHttpsUrl(integration.iconUrl) ?? safeHttpsUrl(integration.iconDarkUrl);
  const custom = customLight
    ? { light: customLight, dark: safeHttpsUrl(integration.iconDarkUrl) }
    : undefined;
  const icon = bySlug ?? custom ?? PROVIDER_ICONS[integration.integrationType];
  const box = { width: size, height: size };

  if (!icon) return <Plug aria-hidden="true" size={size} />;
  if (!icon.dark || icon.dark === icon.light) {
    return <img alt="" src={icon.light} style={box} />;
  }
  return (
    <>
      <img alt="" className="block dark:hidden" src={icon.light} style={box} />
      <img alt="" className="hidden dark:block" src={icon.dark} style={box} />
    </>
  );
}

/** A 32px tile around a provider logo, at a row's leading edge. */
export function ProviderTile({ integration }: { integration: IconSource }) {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <ProviderLogo integration={integration} />
    </div>
  );
}

/** A failure banner: the server's message, or a fallback. */
function ErrorBanner({
  error,
  fallback,
}: {
  error: unknown;
  fallback: string;
}) {
  if (!error) return null;
  const message =
    error instanceof ClientApiError && error.message ? error.message : fallback;
  return (
    <Banner role="alert" status="error">
      <BannerDescription>{message}</BannerDescription>
    </Banner>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-caption text-muted-foreground">{children}</p>;
}

/** Closes a dialog a beat after its action succeeds, so "Done" reads. */
function closeOnSuccess(close: () => void) {
  return (status: string) => {
    if (status === "success") window.setTimeout(close, 400);
  };
}

function DialogFooterButtons({
  onCancel,
  cancelLabel = "Cancel",
  children,
}: {
  onCancel: () => void;
  cancelLabel?: string;
  children: ReactNode;
}) {
  return (
    <>
      <Button onClick={onCancel} type="button" variant="secondary">
        {cancelLabel}
      </Button>
      {children}
    </>
  );
}

/** The signed-in user, who shared (organization) credentials are attributed to. */
function useActingUserId(): string | undefined {
  const { user } = useAuth();
  return user?.id;
}

// ── Config fields ────────────────────────────────────────

/** Seed values from stored config, as strings the inputs can round-trip. */
function initialConfigValues(
  fields: ConfigField[],
  stored: Record<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const value = stored[field.key];
    if (typeof value === "string") values[field.key] = value;
  }
  return values;
}

/**
 * Form state for provider-declared config fields: values, inline validation
 * against `required` / `pattern`, and the payloads the connect inputs take.
 */
function useConfigForm(
  fields: ConfigField[],
  initialValues: Record<string, string> = {},
) {
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const refs = useRef(new Map<string, InlineValidationHandle | null>());

  const commitAll = () => {
    let valid = true;
    for (const field of fields) {
      if (!refs.current.get(field.key)?.commit()) valid = false;
    }
    return valid;
  };

  /** Only the fields with a value; empty means "use the default". */
  const buildConfig = () => {
    const config: Record<string, string> = {};
    for (const field of fields) {
      const value = (values[field.key] ?? "").trim();
      if (value) config[field.key] = value;
    }
    return config;
  };

  /**
   * The whole config to write. The write replaces it wholesale, so keys these
   * fields don't render are kept as received.
   */
  const buildConfigPayload = (stored: Record<string, string>) => {
    const payload: Record<string, string> = { ...stored };
    for (const field of fields) {
      const value = (values[field.key] ?? "").trim();
      if (value) payload[field.key] = value;
      else delete payload[field.key];
    }
    return payload;
  };

  const isDirty = fields.some(
    (field) => (values[field.key] ?? "") !== (initialValues[field.key] ?? ""),
  );
  const hasMissingRequired = fields.some(
    (field) => field.required && !(values[field.key] ?? "").trim(),
  );

  const inputs = fields.map((field) => (
    <InlineValidation
      autoComplete="off"
      hint={
        [
          field.description,
          field.default !== undefined
            ? `Defaults to ${field.default} when left blank.`
            : null,
        ]
          .filter(Boolean)
          .join(" ") || undefined
      }
      id={`data-integration-config-${field.key}`}
      key={field.key}
      label={field.label}
      onChange={(value) =>
        setValues((current) => ({ ...current, [field.key]: value }))
      }
      placeholder={field.default ?? field.example}
      ref={(handle) => {
        refs.current.set(field.key, handle);
      }}
      required={field.required}
      type={field.secret ? "password" : "text"}
      validate={(value) => validateConfigValue(field, value)}
      value={values[field.key] ?? ""}
    />
  ));

  return {
    inputs,
    commitAll,
    buildConfig,
    buildConfigPayload,
    isDirty,
    hasMissingRequired,
  };
}

/** The optional name a dialog collects for a new connection. */
function ConnectionNameField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <InlineValidation
      autoComplete="off"
      hint="Optional"
      id={id}
      label="Name"
      onChange={(next) => onChange(next.slice(0, MAX_LABEL_LENGTH))}
      placeholder="e.g. Marketing"
      validate={() => null}
      value={value}
    />
  );
}

// ── OAuth connect ────────────────────────────────────────

function ConnectDialogHeader({
  integration,
}: {
  integration: IconSource & { name: string };
}) {
  const branding = useWorkOsQuery({
    queryKey: workOsKey("Branding"),
    queryFn: (sdk) => sdk.Branding(),
  });
  const logo = safeHttpsUrl(
    branding.data?.branding.logoLightIconPath ??
      branding.data?.branding.logoLightPath,
  );
  const appName = branding.data?.branding.displayName ?? "This application";
  const separator = (
    <MoreHorizontalIcon
      aria-hidden="true"
      className="size-4 text-muted-foreground"
    />
  );
  const tile = (children: ReactNode) => (
    <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
      {children}
    </div>
  );
  return (
    <div className="flex flex-col items-center gap-4 pb-2">
      <div className="flex items-center gap-2">
        {logo ? (
          <>
            {tile(<img alt="" className="size-6 object-contain" src={logo} />)}
            {separator}
          </>
        ) : null}
        {tile(
          <ProviderLogo
            integration={{ integrationType: "workos" }}
            size={24}
          />,
        )}
        {separator}
        {tile(<ProviderLogo integration={integration} size={24} />)}
      </div>
      <p
        className="text-center text-body text-foreground"
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {appName} uses WorkOS to connect to {integration.name}.
      </p>
    </div>
  );
}

function ExplainerRow({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </div>
      <div className="flex flex-col">
        <span
          className="text-caption text-foreground"
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {title}
        </span>
        <span className="text-caption text-muted-foreground">{body}</span>
      </div>
    </div>
  );
}

/**
 * The connect dialog for OAuth providers. With unpinned installation fields
 * (a Zendesk subdomain, say) it collects them first, then shows the redirect
 * explainer; the values travel as `config` on the authorize call.
 */
export function ConnectDialog({
  integration,
  fields,
  open,
  onOpenChange,
  onConnect,
  collectName = false,
}: {
  integration: IconSource & { id: string; name: string };
  fields: ConfigField[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: ConnectHandler;
  collectName?: boolean;
}) {
  const initialStep = fields.length > 0 ? "fields" : "review";
  const [step, setStep] = useState<"fields" | "review">(initialStep);
  const [error, setError] = useState<unknown>(null);
  const [name, setName] = useState("");
  const config = useConfigForm(fields);
  const close = () => {
    onOpenChange(false);
    setStep(initialStep);
    setName("");
    setError(null);
  };
  const nameField = collectName ? (
    <ConnectionNameField
      id={`data-integration-connect-name-${integration.id}`}
      onChange={setName}
      value={name}
    />
  ) : null;

  return (
    <SettingsDialogShell
      footer={
        step === "fields" ? (
          <DialogFooterButtons onCancel={close}>
            <Button
              disabled={config.hasMissingRequired}
              onClick={() => {
                if (config.commitAll()) setStep("review");
              }}
              type="button"
            >
              Next
            </Button>
          </DialogFooterButtons>
        ) : (
          <>
            {fields.length > 0 ? (
              <Button
                onClick={() => setStep("fields")}
                type="button"
                variant="secondary"
              >
                Back
              </Button>
            ) : (
              <Button onClick={close} type="button" variant="secondary">
                Cancel
              </Button>
            )}
            <LoadingButton
              onAction={async () => {
                setError(null);
                try {
                  await onConnect(
                    config.buildConfig(),
                    collectName ? name : undefined,
                  );
                } catch (cause) {
                  setError(cause);
                  throw cause;
                }
              }}
              onStatusChange={closeOnSuccess(close)}
              pendingLabel="Connecting…"
              successLabel="Opened"
              trailingIcon={ShareUpRight}
            >
              Connect
            </LoadingButton>
          </>
        )
      }
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      open={open}
      title={`Connect ${integration.name}`}
    >
      <div className="flex flex-col gap-4">
        <ConnectDialogHeader integration={integration} />
        {step === "fields" ? (
          <div className="flex flex-col gap-3">
            {nameField}
            {config.inputs}
          </div>
        ) : (
          <>
            <ErrorBanner
              error={error}
              fallback="We couldn't start the connection. Please try again."
            />
            {fields.length === 0 ? nameField : null}
            <div className="flex flex-col gap-4 rounded-xl bg-surface-2 p-4">
              <ExplainerRow
                body="Authorize access to connect your account."
                icon={<Globe />}
                title={`You'll be redirected to sign in with ${integration.name}.`}
              />
              <ExplainerRow
                body="WorkOS never sees your credentials."
                icon={<Lock />}
                title="Your credentials remain secure."
              />
            </div>
          </>
        )}
      </div>
    </SettingsDialogShell>
  );
}

// ── API key ──────────────────────────────────────────────

/** Connect with, rotate, or update an API key. */
export function ApiKeyDialog({
  integration,
  connection,
  owner = "user",
  target,
  open,
  onOpenChange,
  onSuccess,
  collectName = false,
}: {
  integration: { id: string; name: string; description: string | null };
  connection: Connection | null | undefined;
  owner?: ConnectionOwner;
  target: ConnectionTarget | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  collectName?: boolean;
}) {
  const sdk = useWorkOsSdk();
  const invalidate = useInvalidateConnections(owner);
  const userId = useActingUserId();
  const attributionError =
    owner === "organization" && !userId
      ? "Shared credentials require an acting WorkOS user."
      : null;
  const keyRef = useRef<InlineValidationHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<unknown>(null);
  const isRotation =
    connection?.authMethod === "api_key" && connection.state === "connected";
  const last4 = connection?.apiKeyLast4;

  async function save() {
    if (attributionError || !keyRef.current?.commit()) {
      throw new AsyncActionAbortError();
    }
    setError(null);
    const input = {
      dataProviderId: integration.id,
      apiKey: secret.trim(),
      ...creationTargetInput(target),
      ...(collectName ? displayNameInput(name) : {}),
    };
    try {
      if (owner === "organization") {
        await sdk.CreateOrganizationDataProviderConnection({
          input: { ...input, userId },
        });
      } else {
        await sdk.CreateDataProviderConnection({ input });
      }
      invalidate();
      onSuccess?.();
    } catch (cause) {
      setError(cause);
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      description={integration.description ?? undefined}
      footer={
        <DialogFooterButtons onCancel={() => onOpenChange(false)}>
          <LoadingButton
            disabled={Boolean(attributionError)}
            onAction={save}
            onStatusChange={closeOnSuccess(() => onOpenChange(false))}
            pendingLabel={isRotation ? "Rotating…" : "Connecting…"}
            ref={saveRef}
            successLabel={isRotation ? "Rotated" : "Connected"}
          >
            {isRotation ? "Rotate" : "Connect"}
          </LoadingButton>
        </DialogFooterButtons>
      }
      onOpenChange={onOpenChange}
      open={open}
      title={
        isRotation
          ? `Rotate API key for ${integration.name}`
          : `Connect ${integration.name} with API key`
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        {attributionError ? (
          <ErrorBanner
            error={new ClientApiError(attributionError)}
            fallback=""
          />
        ) : (
          <ErrorBanner
            error={error}
            fallback="An error occurred. Please check the value and try again."
          />
        )}
        {collectName ? (
          <ConnectionNameField
            id={`data-integration-api-key-name-${integration.id}`}
            onChange={setName}
            value={name}
          />
        ) : null}
        {isRotation && last4 ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-caption text-muted-foreground">
              Current API key
            </span>
            <span className="text-body text-foreground">
              {API_KEY_REDACTED_PREFIX}
              {last4}
            </span>
          </div>
        ) : null}
        <InlineValidation
          autoComplete="off"
          id={`data-integration-api-key-${integration.id}`}
          label={isRotation ? "New API key" : "API key"}
          onChange={setSecret}
          placeholder="Enter your API key"
          ref={keyRef}
          type="password"
          validate={(value) => (value.trim() ? null : "Enter an API key.")}
          value={secret}
        />
      </form>
    </SettingsDialogShell>
  );
}

// ── Client credentials ───────────────────────────────────

type ClientCredentialsResult =
  | ConnectDataProviderWithClientCredentialsMutation["connectDataProviderWithClientCredentials"]
  | ConnectOrganizationDataProviderWithClientCredentialsMutation["connectOrganizationDataProviderWithClientCredentials"];

function unwrapClientCredentials(result: ClientCredentialsResult) {
  switch (result.__typename) {
    case "DataProviderConnected":
      return result;
    case "DataProviderConfigInvalid":
      throw new ClientApiError(result.message, { codes: [result.__typename] });
    case "DataProviderAuthMethodUnsupported":
    case "DataProviderConnectionAuthMethodConflict":
      throw new ClientApiError("", { codes: [result.__typename] });
  }
}

/** Connect with, or update, client credentials (plus any config fields). */
export function ClientCredentialsDialog({
  integration,
  connection,
  owner = "user",
  target,
  fields,
  open,
  onOpenChange,
  onSuccess,
  collectName = false,
}: {
  integration: { id: string; name: string };
  connection: Connection | null | undefined;
  owner?: ConnectionOwner;
  target: ConnectionTarget | undefined;
  fields: ConfigField[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  collectName?: boolean;
}) {
  const sdk = useWorkOsSdk();
  const invalidate = useInvalidateConnections(owner);
  const userId = useActingUserId();
  const attributionError =
    owner === "organization" && !userId
      ? "Shared credentials require an acting WorkOS user."
      : null;
  const isUpdate = connection?.authMethod === "client_credentials";
  const storedConfig = useMemo(
    () => (isUpdate ? (connection?.config ?? {}) : {}),
    [isUpdate, connection?.config],
  );
  const config = useConfigForm(
    fields,
    useMemo(
      () => initialConfigValues(fields, storedConfig),
      [fields, storedConfig],
    ),
  );
  const maskedSecret = redactedSecret(
    isUpdate ? connection?.clientSecretLast4 : null,
  );
  const idRef = useRef<InlineValidationHandle>(null);
  const secretRef = useRef<InlineValidationHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState(
    (isUpdate ? connection?.clientId : null) ?? "",
  );
  const [clientSecret, setClientSecret] = useState(maskedSecret);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    const validId = idRef.current?.commit() ?? false;
    const validSecret = secretRef.current?.commit() ?? false;
    const validConfig = config.commitAll();
    if (attributionError || !validId || !validSecret || !validConfig) {
      throw new AsyncActionAbortError();
    }
    setError(null);
    const input = {
      dataProviderId: integration.id,
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      config: config.isDirty
        ? configEntries(config.buildConfigPayload(storedConfig))
        : undefined,
      ...creationTargetInput(target),
      ...(collectName ? displayNameInput(name) : {}),
    };
    try {
      if (owner === "organization") {
        const { connectOrganizationDataProviderWithClientCredentials: result } =
          await sdk.ConnectOrganizationDataProviderWithClientCredentials({
            input: { ...input, userId },
          });
        unwrapClientCredentials(result);
      } else {
        const { connectDataProviderWithClientCredentials: result } =
          await sdk.ConnectDataProviderWithClientCredentials({ input });
        unwrapClientCredentials(result);
      }
      invalidate();
      onSuccess?.();
    } catch (cause) {
      setError(cause);
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      footer={
        <DialogFooterButtons onCancel={() => onOpenChange(false)}>
          <LoadingButton
            disabled={Boolean(attributionError) || config.hasMissingRequired}
            onAction={save}
            onStatusChange={closeOnSuccess(() => onOpenChange(false))}
            pendingLabel="Saving…"
            ref={saveRef}
            successLabel={isUpdate ? "Saved" : "Connected"}
          >
            {isUpdate ? "Save" : "Connect"}
          </LoadingButton>
        </DialogFooterButtons>
      }
      onOpenChange={onOpenChange}
      open={open}
      title={
        isUpdate
          ? `Update client credentials for ${integration.name}`
          : `Connect ${integration.name} with client credentials`
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        {attributionError ? (
          <ErrorBanner
            error={new ClientApiError(attributionError)}
            fallback=""
          />
        ) : (
          <ErrorBanner
            error={error}
            fallback="An error occurred. Please check the value and try again."
          />
        )}
        {collectName ? (
          <ConnectionNameField
            id={`data-integration-client-credentials-name-${integration.id}`}
            onChange={setName}
            value={name}
          />
        ) : null}
        <InlineValidation
          autoComplete="off"
          id={`data-integration-client-id-${integration.id}`}
          label="Client ID"
          onChange={setClientId}
          placeholder="Enter your client ID"
          ref={idRef}
          validate={(value) => (value.trim() ? null : "This field is required")}
          value={clientId}
        />
        <InlineValidation
          autoComplete="off"
          hint={
            isUpdate
              ? "Enter the client secret again to save any changes."
              : undefined
          }
          id={`data-integration-client-secret-${integration.id}`}
          label="Client secret"
          onChange={setClientSecret}
          placeholder="Enter your client secret"
          ref={secretRef}
          type={isRedactedSecret(clientSecret) ? "text" : "password"}
          validate={(value) =>
            !value.trim() || isRedactedSecret(value)
              ? "Enter the client secret."
              : null
          }
          value={clientSecret}
        />
        {config.inputs}
      </form>
    </SettingsDialogShell>
  );
}

// ── Rename ───────────────────────────────────────────────

/**
 * Renames one connection. A duplicate name never blocks the save: when the
 * API warns about one, the dialog stays open on the saved name to say so.
 */
export function RenameConnectionDialog({
  integrationName,
  connection,
  owner = "user",
  open,
  onOpenChange,
}: {
  integrationName: string;
  connection: Connection;
  owner?: ConnectionOwner;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const sdk = useWorkOsSdk();
  const invalidate = useInvalidateConnections(owner);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [label, setLabel] = useState(connection.accountDisplayName ?? "");
  const [saved, setSaved] = useState<{
    label: string;
    warnings: { code: string; message: string }[];
  } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const trimmed = label.trim();
  const savedLabel = saved
    ? saved.label
    : (connection.accountDisplayName ?? "");
  const unchanged = trimmed === savedLabel;
  // Warnings describe the saved name, so they stand only while it's shown.
  const warnings = unchanged ? (saved?.warnings ?? []) : [];

  async function save() {
    if (unchanged) throw new AsyncActionAbortError();
    setError(null);
    const input = { id: connection.id, accountDisplayName: trimmed || null };
    try {
      const result =
        owner === "organization"
          ? (await sdk.UpdateOrganizationDataProviderConnectionLabel({ input }))
              .updateOrganizationDataProviderConnectionLabel
          : (await sdk.UpdateDataProviderConnectionLabel({ input }))
              .updateDataProviderConnectionLabel;
      invalidate();
      setSaved({
        label: result.connection.accountDisplayName ?? "",
        warnings: result.warnings,
      });
      if (result.warnings.length === 0) onOpenChange(false);
    } catch (cause) {
      setError(cause);
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      description={`Give this connection a name to tell it apart from your other ${integrationName} connections.`}
      footer={
        <DialogFooterButtons
          cancelLabel={warnings.length > 0 ? "Done" : "Cancel"}
          onCancel={() => onOpenChange(false)}
        >
          <LoadingButton
            disabled={unchanged}
            onAction={save}
            pendingLabel="Saving…"
            ref={saveRef}
            successLabel="Saved"
          >
            Save
          </LoadingButton>
        </DialogFooterButtons>
      }
      onOpenChange={onOpenChange}
      open={open}
      title={`Rename ${integrationName} connection`}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        <ErrorBanner
          error={error}
          fallback="An error occurred while renaming this connection. Please try again."
        />
        {warnings.map((warning) => (
          <Banner key={warning.code} role="status" status="warning">
            <BannerDescription>
              {warning.code === DUPLICATE_LABEL_WARNING
                ? `Saved. Another ${integrationName} connection already uses this name, so you may want to pick one that tells them apart.`
                : warning.message}
            </BannerDescription>
          </Banner>
        ))}
        <InlineValidation
          autoComplete="off"
          id={`rename-connection-${connection.id}`}
          label="Name"
          onChange={(next) => setLabel(next.slice(0, MAX_LABEL_LENGTH))}
          placeholder="e.g. Marketing"
          validate={() => null}
          value={label}
        />
      </form>
    </SettingsDialogShell>
  );
}

// ── Disconnect ───────────────────────────────────────────

export function DisconnectDialog({
  integrationName,
  connectionId,
  owner,
  open,
  onOpenChange,
  onSuccess,
}: {
  integrationName: string;
  connectionId: string;
  owner: ConnectionOwner;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}) {
  const sdk = useWorkOsSdk();
  const invalidate = useInvalidateConnections(owner);
  const shared = owner === "organization";
  return (
    <SettingsConfirmDialog
      confirmLabel="Disconnect"
      description={
        shared
          ? `Are you sure you want to disconnect the ${integrationName} account your organization shares with everyone? Members will lose access to it.`
          : `Are you sure you want to disconnect your ${integrationName} account?`
      }
      onConfirm={async () => {
        try {
          if (shared) {
            await sdk.DeleteOrganizationDataProviderConnection({
              id: connectionId,
            });
          } else {
            await sdk.DeleteDataProviderConnection({ id: connectionId });
          }
        } catch {
          throw new ClientApiError(
            shared
              ? "An error occurred while disconnecting this connection. Please refresh the page and try again."
              : "An error occurred while disconnecting your account. Please refresh the page and try again.",
          );
        }
        invalidate();
        onSuccess?.();
      }}
      onOpenChange={onOpenChange}
      open={open}
      pendingLabel="Disconnecting…"
      successLabel="Disconnected"
      title={shared ? "Disconnect shared connection" : "Disconnect account"}
    />
  );
}

// ── Configure (admins) ───────────────────────────────────

type SetConfigurationResult =
  | SetDataProviderConfigurationMutation["setDataProviderConfiguration"]
  | SetOrganizationDataProviderConfigurationMutation["setOrganizationDataProviderConfiguration"];

function unwrapConfiguration(result: SetConfigurationResult) {
  if (result.__typename === "DataProviderConfigInvalid") {
    throw new ClientApiError(result.message, { codes: [result.__typename] });
  }
  return result;
}

/** Searchable multi-select of scopes. */
function ScopePicker({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? options.filter((scope) => scope.toLowerCase().includes(normalized))
    : options;
  const checked = new Set(
    filtered.flatMap((scope, index) =>
      selected.includes(scope) ? [index] : [],
    ),
  );
  return (
    <div className="flex flex-col gap-2">
      <SettingsSearchField
        label="Search scopes"
        onChange={setQuery}
        placeholder="Search scopes"
        value={query}
      />
      <ScrollArea className="max-h-56" viewportClassName="scroll-fade">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-body text-muted-foreground">
            No scopes found
          </p>
        ) : (
          <CheckboxGroup checkedIndices={checked}>
            {filtered.map((scope, index) => (
              <CheckboxItem
                checked={selected.includes(scope)}
                index={index}
                key={scope}
                label={scope}
                onToggle={() =>
                  onChange(
                    selected.includes(scope)
                      ? selected.filter((entry) => entry !== scope)
                      : [...selected, scope],
                  )
                }
              />
            ))}
          </CheckboxGroup>
        )}
      </ScrollArea>
    </div>
  );
}

/**
 * Configures a provider for the organization: whether members can connect
 * it, the organization's own OAuth client (when credentials are the
 * organization's), integration-scope config, and the allowed scopes.
 */
export function ConfigureIntegrationDialog({
  integration,
  owner = "user",
  open,
  onOpenChange,
}: {
  integration: ConfigurableIntegration;
  owner?: ConnectionOwner;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const sdk = useWorkOsSdk();
  const invalidate = useInvalidateConfiguration(owner);
  const credentials = integration.credentials;
  const isOrgCredentials = credentials.credentialsType === "organization";
  const isApiKeyOnly = !integration.authMethods.includes("oauth");
  const maskedSecret = redactedSecret(credentials.redactedClientSecret);
  const [enabled, setEnabled] = useState(integration.enabled);
  const [scopes, setScopes] = useState<string[]>(integration.scopes);
  const [step, setStep] = useState<"credentials" | "scopes">("credentials");
  const [clientId, setClientId] = useState(credentials.clientId ?? "");
  const [clientSecret, setClientSecret] = useState(maskedSecret);
  const [error, setError] = useState<unknown>(null);
  const idRef = useRef<InlineValidationHandle>(null);
  const secretRef = useRef<InlineValidationHandle>(null);

  const configFields = useMemo(
    () =>
      isOrgCredentials
        ? integration.configFields
            .filter((field) => field.scope === "integration" && !field.secret)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        : [],
    [integration.configFields, isOrgCredentials],
  );
  const secretKeys = new Set(
    integration.configFields
      .filter((field) => field.secret)
      .map((field) => field.key),
  );
  const config = useConfigForm(
    configFields,
    useMemo(
      () => initialConfigValues(configFields, integration.config),
      [configFields, integration.config],
    ),
  );

  const scopePool = isOrgCredentials
    ? [
        ...new Set([
          ...integration.scopes,
          ...integration.defaultScopes,
          ...integration.availableScopes,
        ]),
      ]
    : [...new Set([...integration.scopes, ...integration.defaultScopes])];
  const removedDefaults = integration.defaultScopes.filter(
    (scope) => !scopes.includes(scope),
  );

  const secretUnchanged =
    credentials.hasCredentials && isRedactedSecret(clientSecret);
  const scopesChanged =
    scopes.length !== integration.scopes.length ||
    scopes.some((scope) => !integration.scopes.includes(scope));
  const credentialsChanged =
    isOrgCredentials &&
    (clientId.trim() !== (credentials.clientId ?? "") ||
      (clientSecret.trim() !== "" && !isRedactedSecret(clientSecret)));
  const hasChanges =
    enabled !== integration.enabled ||
    scopesChanged ||
    credentialsChanged ||
    config.isDirty;

  const showCredentialsStep =
    !isApiKeyOnly && isOrgCredentials && step === "credentials";
  const showScopesStep =
    !isApiKeyOnly && (!isOrgCredentials || step === "scopes");

  function validateCredentials() {
    const validId = idRef.current?.commit() ?? false;
    const validSecret = secretRef.current?.commit() ?? false;
    return validId && validSecret;
  }

  async function save() {
    if (!isOrgCredentials && !config.commitAll()) {
      throw new AsyncActionAbortError();
    }
    setError(null);
    // Secret-scoped keys never round-trip, so they're left out of the write.
    const stored = Object.fromEntries(
      Object.entries(integration.config).filter(
        ([key]) => !secretKeys.has(key),
      ),
    );
    const configPayload =
      configFields.length > 0
        ? { config: configEntries(config.buildConfigPayload(stored)) }
        : {};
    const input = {
      dataProviderId: integration.id,
      enabled,
      ...configPayload,
      ...(isApiKeyOnly ? {} : { scopes }),
      ...(isOrgCredentials && !isApiKeyOnly && !secretUnchanged
        ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() }
        : {}),
    };
    try {
      if (owner === "organization") {
        unwrapConfiguration(
          (await sdk.SetOrganizationDataProviderConfiguration({ input }))
            .setOrganizationDataProviderConfiguration,
        );
      } else {
        unwrapConfiguration(
          (await sdk.SetDataProviderConfiguration({ input }))
            .setDataProviderConfiguration,
        );
      }
      invalidate();
    } catch (cause) {
      setError(cause);
      throw cause;
    }
  }

  const enableToggle = (
    <div className="flex items-center gap-2">
      <Switch
        checked={enabled}
        label="Enable"
        onToggle={() => setEnabled((current) => !current)}
      />
      <Tooltip content="Allow this integration to be connected in your organization.">
        <span className="inline-flex text-muted-foreground">
          <InfoIcon aria-hidden="true" className="size-4" />
        </span>
      </Tooltip>
    </div>
  );

  return (
    <SettingsDialogShell
      description={integration.description ?? undefined}
      footer={
        <DialogFooterButtons onCancel={() => onOpenChange(false)}>
          {showCredentialsStep ? (
            <Button
              disabled={
                !clientId.trim() ||
                !clientSecret.trim() ||
                config.hasMissingRequired
              }
              onClick={() => {
                const credentialsValid = validateCredentials();
                const configValid = config.commitAll();
                if (credentialsValid && configValid) setStep("scopes");
              }}
              type="button"
            >
              Next
            </Button>
          ) : (
            <>
              {isOrgCredentials && !isApiKeyOnly ? (
                <Button
                  onClick={() => setStep("credentials")}
                  type="button"
                  variant="secondary"
                >
                  Back
                </Button>
              ) : null}
              <LoadingButton
                disabled={!hasChanges || config.hasMissingRequired}
                onAction={save}
                onStatusChange={closeOnSuccess(() => onOpenChange(false))}
                pendingLabel="Saving…"
                successLabel="Saved"
              >
                Save
              </LoadingButton>
            </>
          )}
        </DialogFooterButtons>
      }
      onOpenChange={onOpenChange}
      open={open}
      size="lg"
      title={`Configure ${integration.name} for your organization`}
    >
      <div className="flex flex-col gap-4">
        <ErrorBanner
          error={error}
          fallback="We couldn't save these settings. Please check the values and try again."
        />
        {isApiKeyOnly ? (
          <>
            {enableToggle}
            {config.inputs}
          </>
        ) : null}
        {showCredentialsStep ? (
          <>
            {enableToggle}
            <InputCopy label="Redirect URI" value={credentials.redirectUri} />
            <InlineValidation
              autoComplete="off"
              id={`configure-client-id-${integration.id}`}
              label={`${integration.name} Client ID`}
              onChange={setClientId}
              placeholder={`Enter your ${integration.name} Client ID`}
              ref={idRef}
              validate={(value) =>
                value.trim() ? null : "This field is required"
              }
              value={clientId}
            />
            <InlineValidation
              autoComplete="off"
              id={`configure-client-secret-${integration.id}`}
              label={`${integration.name} Client Secret`}
              onChange={setClientSecret}
              placeholder={`Enter your ${integration.name} Client Secret`}
              ref={secretRef}
              type={isRedactedSecret(clientSecret) ? "text" : "password"}
              validate={(value) => {
                if (credentials.hasCredentials && isRedactedSecret(value)) {
                  return clientId.trim() &&
                    clientId.trim() !== (credentials.clientId ?? "")
                    ? "Enter a new Client Secret to change the Client ID."
                    : null;
                }
                return value.trim() ? null : "This field is required";
              }}
              value={clientSecret}
            />
            {config.inputs}
          </>
        ) : null}
        {showScopesStep ? (
          <>
            {!isOrgCredentials ? enableToggle : null}
            {!isOrgCredentials ? config.inputs : null}
            {scopePool.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-0.5">
                  <span
                    className="text-body text-foreground"
                    style={{ fontVariationSettings: fontWeights.semibold }}
                  >
                    Allowed scopes
                  </span>
                  <Hint>
                    Selected scopes may be requested by your app. Users still
                    authorize access during their own OAuth flow.
                  </Hint>
                </div>
                <ScopePicker
                  onChange={setScopes}
                  options={scopePool}
                  selected={scopes}
                />
                {removedDefaults.length > 0 ? (
                  <Banner role="status" status="warning">
                    <BannerDescription>
                      You removed developer-configured scopes:{" "}
                      {removedDefaults.join(", ")}. This may break this
                      integration.
                    </BannerDescription>
                  </Banner>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </SettingsDialogShell>
  );
}
