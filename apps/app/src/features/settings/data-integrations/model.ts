// Data integrations ("Pipes") on the WorkOS Client API: the view shapes the
// panel renders and the hooks that load them. Ported from
// @workos-inc/widgets (MIT, Copyright (c) 2024 WorkOS), src/lib/api/pipes.ts
// and src/widgets/pipes/pipes-connections.tsx.

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useClientApiSession } from "../../workos-client-api/client-api-session";
import {
  useWorkOsQuery,
  workOsKey,
  type Sdk,
} from "../../workos-client-api/sdk";
import type {
  ConnectionIntent,
  DataProviderConfigEntryInput,
  DataProviderConfigFieldFieldsFragment,
  DataProviderConnectionFieldsFragment,
  DataProviderFieldsFragment,
  OrganizationDataProviderFieldsFragment,
  SharedDataProviderFieldsFragment,
} from "../../workos-client-api/vendor/generated";

export type ConnectionOwner = "user" | "organization";
export type AuthMethod = "oauth" | "api_key" | "client_credentials";

/** Connect methods, in the order they're offered. */
export const CONNECT_AUTH_METHODS: readonly AuthMethod[] = [
  "oauth",
  "client_credentials",
  "api_key",
];

export type ConfigField = {
  key: string;
  label: string;
  required: boolean;
  scope: "integration" | "installation";
  description?: string;
  example?: string;
  pattern?: string;
  patternFlags?: string;
  order?: number;
  secret?: boolean;
  default?: string;
};

export type IconSource = {
  integrationType: string;
  iconSlug?: string | null;
  iconUrl?: string | null;
  iconDarkUrl?: string | null;
};

export type Connection = {
  id: string;
  role: "standard" | "compatibility";
  accountIdentifier: string | null;
  accountDisplayName: string | null;
  authMethod: AuthMethod;
  state: "connected" | "needs_reauthorization";
  apiKeyLast4: string | null;
  clientId: string | null;
  clientSecretLast4: string | null;
  config: Record<string, string>;
  createdAt: string;
  /** Repair actions for organization-owned connections; null for a member's own. */
  capabilities: {
    canReauthorize: boolean;
    canUpdateCredentials: boolean;
  } | null;
};

export type AddCapabilities = {
  canAddConnection: boolean;
  /** Empty exactly when `canAddConnection` is false. */
  addConnectionMethods: AuthMethod[];
};

export type Credentials = {
  credentialsType: "shared" | "custom" | "organization";
  hasCredentials: boolean;
  clientId: string | null;
  redactedClientSecret: string | null;
  redirectUri: string;
};

/** A provider a member (or the organization) can connect, with its connections. */
export type Integration = IconSource & {
  id: string;
  name: string;
  description: string | null;
  authMethods: AuthMethod[];
  configFields: ConfigField[];
  config: Record<string, string>;
  /** Every connection, oldest first. */
  connections: Connection[];
  capabilities: AddCapabilities;
};

/** An organization-owned provider, with its configuration and capabilities. */
export type OrganizationIntegration = Integration & {
  enabled: boolean;
  disabledSource: "developer" | "organization" | null;
  configured: boolean;
  scopes: string[];
  defaultScopes: string[];
  availableScopes: string[];
  credentials: Credentials;
  organizationCapabilities: {
    canConfigure: boolean;
    canConnect: boolean;
    canDisconnect: boolean;
    canReauthorize: boolean;
    canUpdateCredentials: boolean;
  };
};

/** The organization's policy for a member-connectable provider. */
export type ConfigurableIntegration = IconSource & {
  id: string;
  name: string;
  description: string | null;
  authMethods: AuthMethod[];
  enabled: boolean;
  scopes: string[];
  defaultScopes: string[];
  availableScopes: string[];
  credentials: Credentials;
  configFields: ConfigField[];
  config: Record<string, string>;
};

/** An organization-shared provider as members see it: state only. */
export type SharedIntegration = IconSource & {
  id: string;
  name: string;
  description: string | null;
  connections: {
    id: string;
    state: Connection["state"];
    availability: "available" | "needs_admin_attention";
  }[];
};

function isOneOf<const T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value);
}

const AUTH_METHODS = ["oauth", "api_key", "client_credentials"] as const;
const CREDENTIALS_TYPES = ["shared", "custom", "organization"] as const;

function toAuthMethods(methods: readonly string[]): AuthMethod[] {
  return methods.filter((method) => isOneOf(AUTH_METHODS, method));
}

// The API carries these as strings; unknown values fall back to the option
// that renders the least capable state.
function toState(state: string): Connection["state"] {
  return state === "connected" ? "connected" : "needs_reauthorization";
}

function toConfig(
  entries: readonly { name: string; value: string }[],
): Record<string, string> {
  return Object.fromEntries(entries.map(({ name, value }) => [name, value]));
}

function toConfigField(
  field: DataProviderConfigFieldFieldsFragment,
): ConfigField {
  return {
    key: field.key,
    label: field.label,
    required: field.required,
    scope: field.scope === "installation" ? "installation" : "integration",
    description: field.description ?? undefined,
    example: field.example ?? undefined,
    pattern: field.pattern ?? undefined,
    patternFlags: field.patternFlags ?? undefined,
    order: field.order ?? undefined,
    secret: field.secret ?? undefined,
    default: field.default ?? undefined,
  };
}

function toIconSource(provider: {
  integrationType: string;
  iconSlug?: string | null;
  iconUrl?: string | null;
  iconDarkUrl?: string | null;
}): IconSource {
  return {
    integrationType: provider.integrationType,
    iconSlug: provider.iconSlug,
    iconUrl: provider.iconUrl,
    iconDarkUrl: provider.iconDarkUrl,
  };
}

function toAddCapabilities(capabilities: {
  canAddConnection: boolean;
  addConnectionMethods: readonly string[];
}): AddCapabilities {
  const addConnectionMethods = toAuthMethods(capabilities.addConnectionMethods);
  return {
    canAddConnection:
      capabilities.canAddConnection && addConnectionMethods.length > 0,
    addConnectionMethods,
  };
}

function toConnection(
  connection: DataProviderConnectionFieldsFragment,
): Connection {
  return {
    id: connection.id,
    role:
      connection.connectionRole === "Standard" ? "standard" : "compatibility",
    accountIdentifier: connection.accountIdentifier ?? null,
    accountDisplayName: connection.accountDisplayName ?? null,
    authMethod: isOneOf(AUTH_METHODS, connection.authMethod)
      ? connection.authMethod
      : "oauth",
    state: toState(connection.state),
    apiKeyLast4: connection.apiKeyLast4 ?? null,
    clientId: connection.clientId ?? null,
    clientSecretLast4: connection.clientSecretLast4 ?? null,
    config: toConfig(connection.config),
    createdAt: connection.createdAt,
    capabilities: connection.capabilities
      ? {
          canReauthorize: connection.capabilities.canReauthorize,
          canUpdateCredentials: connection.capabilities.canUpdateCredentials,
        }
      : null,
  };
}

/** Oldest first: by creation time, then id. */
function byCreation(a: Connection, b: Connection) {
  return (
    Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

function toCredentials(
  credentials: OrganizationDataProviderFieldsFragment["credentials"],
): Credentials {
  return {
    credentialsType: isOneOf(CREDENTIALS_TYPES, credentials.credentialsType)
      ? credentials.credentialsType
      : "shared",
    hasCredentials: credentials.hasCredentials,
    clientId: credentials.clientId ?? null,
    redactedClientSecret: credentials.redactedClientSecret ?? null,
    redirectUri: credentials.redirectUri,
  };
}

function toMyIntegrations(
  providers: readonly DataProviderFieldsFragment[],
  connections: readonly DataProviderConnectionFieldsFragment[],
): Integration[] {
  const byProvider = new Map<string, Connection[]>();
  for (const connection of connections) {
    const list = byProvider.get(connection.dataProviderId) ?? [];
    list.push(toConnection(connection));
    byProvider.set(connection.dataProviderId, list);
  }
  return providers.map((provider) => ({
    ...toIconSource(provider),
    id: provider.id,
    name: provider.name,
    description: provider.description ?? null,
    authMethods: toAuthMethods(provider.authMethods),
    configFields: provider.configFields.map(toConfigField),
    config: toConfig(provider.config),
    connections: (byProvider.get(provider.id) ?? []).sort(byCreation),
    capabilities: toAddCapabilities(provider.capabilities),
  }));
}

function toOrganizationIntegration(
  provider: OrganizationDataProviderFieldsFragment,
): OrganizationIntegration {
  const disabledSource = provider.disabledSource ?? null;
  return {
    ...toIconSource(provider),
    id: provider.id,
    name: provider.name,
    description: provider.description ?? null,
    authMethods: toAuthMethods(provider.authMethods),
    configFields: provider.configFields.map(toConfigField),
    config: toConfig(provider.config),
    connections: provider.connectedAccounts.map(toConnection).sort(byCreation),
    capabilities: toAddCapabilities(provider.capabilities),
    enabled: provider.enabled,
    disabledSource:
      disabledSource === "developer" || disabledSource === "organization"
        ? disabledSource
        : null,
    configured: provider.configured,
    scopes: provider.scopes ?? [],
    defaultScopes: provider.defaultScopes,
    availableScopes: provider.availableScopes,
    credentials: toCredentials(provider.credentials),
    organizationCapabilities: {
      canConfigure: provider.capabilities.canConfigure,
      canConnect: provider.capabilities.canConnect,
      canDisconnect: provider.capabilities.canDisconnect,
      canReauthorize: provider.capabilities.canReauthorize,
      canUpdateCredentials: provider.capabilities.canUpdateCredentials,
    },
  };
}

/** An organization-owned provider in the shape the configure dialog edits. */
export function organizationIntegrationConfiguration(
  integration: OrganizationIntegration,
): ConfigurableIntegration {
  return {
    integrationType: integration.integrationType,
    iconSlug: integration.iconSlug,
    iconUrl: integration.iconUrl,
    iconDarkUrl: integration.iconDarkUrl,
    id: integration.id,
    name: integration.name,
    description: integration.description,
    authMethods: integration.authMethods.length
      ? integration.authMethods
      : ["oauth"],
    enabled: integration.enabled,
    scopes: integration.scopes,
    defaultScopes: integration.defaultScopes,
    availableScopes: integration.availableScopes,
    credentials: integration.credentials,
    configFields: integration.configFields,
    config: integration.config,
  };
}

function toSharedIntegration(
  provider: SharedDataProviderFieldsFragment,
): SharedIntegration {
  return {
    ...toIconSource(provider),
    id: provider.id,
    name: provider.name,
    description: provider.description ?? null,
    connections: provider.connectedAccounts.map((connection) => ({
      id: connection.id,
      state: toState(connection.state),
      availability:
        connection.availability === "available"
          ? "available"
          : "needs_admin_attention",
    })),
  };
}

const PAGE_SIZE = 100;

/** The list queries default to 10 rows; every list is walked to its end. */
async function listAll<T>(
  fetchPage: (after: string | null) => Promise<{
    data: T[];
    listMetadata: { after?: string | null };
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  do {
    const page = await fetchPage(after);
    rows.push(...page.data);
    after = page.listMetadata.after ?? null;
  } while (after !== null);
  return rows;
}

const listProviders = (sdk: Sdk) =>
  listAll(async (after) => {
    const { dataProviders } = await sdk.ListDataProviders({
      after,
      limit: PAGE_SIZE,
    });
    return dataProviders;
  });

const listConnections = (sdk: Sdk) =>
  listAll(async (after) => {
    const { dataProviderConnections } = await sdk.ListDataProviderConnections({
      after,
      limit: PAGE_SIZE,
    });
    return dataProviderConnections;
  });

const listOrganizationProviders = (sdk: Sdk) =>
  listAll(async (after) => {
    const { organizationDataProviders } =
      await sdk.ListOrganizationDataProviders({ after, limit: PAGE_SIZE });
    return organizationDataProviders;
  });

const listSharedProviders = (sdk: Sdk) =>
  listAll(async (after) => {
    const { sharedDataProviders } = await sdk.ListSharedDataProviders({
      after,
      limit: PAGE_SIZE,
    });
    return sharedDataProviders;
  });

/** The member's connectable providers joined with their own connections. */
export function useMyIntegrations() {
  const providers = useWorkOsQuery({
    queryKey: workOsKey("ListDataProviders"),
    queryFn: listProviders,
  });
  const connections = useWorkOsQuery({
    queryKey: workOsKey("ListDataProviderConnections"),
    queryFn: listConnections,
  });
  const isSuccess = providers.isSuccess && connections.isSuccess;
  return {
    data: isSuccess ? toMyIntegrations(providers.data, connections.data) : [],
    isPending: providers.isPending || connections.isPending,
    isError: providers.isError || connections.isError,
    error: providers.error ?? connections.error,
  };
}

/** The organization's provider inventory with its shared connections. */
export function useOrganizationIntegrations(enabled: boolean) {
  return useWorkOsQuery({
    queryKey: workOsKey("ListOrganizationDataProviders"),
    queryFn: listOrganizationProviders,
    select: (providers) => providers.map(toOrganizationIntegration),
    enabled,
  });
}

/** The organization's shared connections, readable by any active member. */
export function useSharedIntegrations(enabled: boolean) {
  return useWorkOsQuery({
    queryKey: workOsKey("ListSharedDataProviders"),
    queryFn: listSharedProviders,
    select: (providers) => providers.map(toSharedIntegration),
    enabled,
  });
}

/** The organization's policy configuration of each connectable provider. */
/** Refreshes whatever a write for `owner` changed. */
export function useInvalidateConnections(owner: ConnectionOwner) {
  const queryClient = useQueryClient();
  return useCallback(() => {
    const keys =
      owner === "organization"
        ? [
            workOsKey("ListOrganizationDataProviders"),
            workOsKey("ListSharedDataProviders"),
          ]
        : [
            workOsKey("ListDataProviders"),
            workOsKey("ListDataProviderConnections"),
          ];
    for (const queryKey of keys) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [owner, queryClient]);
}

/** Refreshes the configuration lists after a provider is configured. */
export function useInvalidateConfiguration(owner: ConnectionOwner) {
  const queryClient = useQueryClient();
  const invalidateConnections = useInvalidateConnections(owner);
  return useCallback(() => {
    if (owner === "user") {
      void queryClient.invalidateQueries({
        queryKey: workOsKey("ListConfigurableDataProviders"),
      });
    }
    invalidateConnections();
  }, [invalidateConnections, owner, queryClient]);
}

function tokenPermissions(token: string | null | undefined): string[] {
  if (!token) return [];
  try {
    const payload = token.split(".")[1];
    if (!payload) return [];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { permissions?: unknown };
    return Array.isArray(claims.permissions)
      ? claims.permissions.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
  } catch {
    return [];
  }
}

/** Whether the session may manage the organization's data integrations. */
export function useCanManageIntegrations(): boolean {
  const { session } = useClientApiSession();
  return tokenPermissions(session?.token).includes("widgets:pipes:manage");
}

export function useCurrentOrganizationName(): string | undefined {
  const organizations = useWorkOsQuery({
    queryKey: workOsKey("ListUserOrganizations"),
    queryFn: (sdk) => sdk.ListUserOrganizations(),
  });
  return organizations.data?.organizations.find(
    (organization) => organization.isCurrent,
  )?.name;
}

/** How one connection is named within its provider's group. */
export function connectionLabel(
  integrationName: string,
  connection: Connection,
): string {
  return (
    connection.accountDisplayName?.trim() ||
    connection.accountIdentifier ||
    integrationName
  );
}

/**
 * Which connection a connect flow writes. Unset writes the owner's single
 * compatibility connection, creating it if there is none.
 */
export type ConnectionTarget =
  | { intent: "Add"; idempotencyKey?: string }
  | { intent: "Reauthorize"; connectedAccountId: string };

function createIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** One logical Add, with an idempotency key reused across its retries. */
export function createAddTarget(): ConnectionTarget {
  return { intent: "Add", idempotencyKey: createIdempotencyKey() };
}

/** The target for writing an existing connection's credentials. */
export function connectionTarget(
  connection: Connection | null | undefined,
): ConnectionTarget | undefined {
  return connection?.role === "standard"
    ? { intent: "Reauthorize", connectedAccountId: connection.id }
    : undefined;
}

/** Connections can be renamed once a provider can hold more than one. */
export function canRenameConnections(integration: {
  capabilities: AddCapabilities;
  connections: Connection[];
}): boolean {
  return (
    integration.capabilities.canAddConnection ||
    integration.connections.some((connection) => connection.role === "standard")
  );
}

export function targetInput(target: ConnectionTarget | undefined): {
  connectionIntent?: ConnectionIntent;
  connectedAccountId?: string;
} {
  if (!target) return {};
  return target.intent === "Add"
    ? { connectionIntent: "Add" }
    : {
        connectionIntent: "Reauthorize",
        connectedAccountId: target.connectedAccountId,
      };
}

/** `targetInput` plus the Add's idempotency key, for synchronous creates. */
export function creationTargetInput(target: ConnectionTarget | undefined) {
  const input = targetInput(target);
  return target?.intent === "Add" && target.idempotencyKey
    ? { ...input, idempotencyKey: target.idempotencyKey }
    : input;
}

export function displayNameInput(name: string | undefined): {
  accountDisplayName?: string;
} {
  const trimmed = name?.trim();
  return trimmed ? { accountDisplayName: trimmed } : {};
}

export function configEntries(
  config: Record<string, string> | undefined,
): DataProviderConfigEntryInput[] | undefined {
  return config
    ? Object.entries(config).map(([name, value]) => ({ name, value }))
    : undefined;
}

/**
 * The provider's installation-scope config fields not pinned at the
 * integration level, in descriptor order: what a connect flow must ask for.
 */
export function unpinnedInstallationFields(integration: {
  configFields: ConfigField[];
  config: Record<string, string>;
}): ConfigField[] {
  return integration.configFields
    .filter(
      (field) =>
        field.scope === "installation" && !integration.config[field.key],
    )
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Methods the owner can add another connection with, in offer order. */
export function addConnectionMethods(
  capabilities: AddCapabilities,
): AuthMethod[] {
  if (!capabilities.canAddConnection) return [];
  return CONNECT_AUTH_METHODS.filter((method) =>
    capabilities.addConnectionMethods.includes(method),
  );
}

const REDACTED_SECRET_PREFIX = "••••••••••••••••";

/** Masked display value for an existing secret: 16 bullets + the last 4. */
export function redactedSecret(last4: string | null | undefined): string {
  return last4 ? `${REDACTED_SECRET_PREFIX}${last4}` : "";
}

export function isRedactedSecret(value: string): boolean {
  return value.startsWith(REDACTED_SECRET_PREFIX);
}

/** Anchored like the server, so the inline error matches its validation. */
export function compileConfigPattern(
  pattern: string,
  flags: string | undefined,
): RegExp | undefined {
  try {
    return new RegExp(`^(?:${pattern})$`, flags);
  } catch {
    return undefined;
  }
}

/** Validates one config value against its descriptor. */
export function validateConfigValue(field: ConfigField, raw: string) {
  const value = raw.trim();
  if (field.required && !value) return "This field is required";
  if (value && field.pattern) {
    const pattern = compileConfigPattern(field.pattern, field.patternFlags);
    if (pattern && !pattern.test(value)) return "Enter a valid value.";
  }
  return null;
}
