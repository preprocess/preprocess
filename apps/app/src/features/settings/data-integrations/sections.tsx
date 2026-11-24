"use client";

// Member and administrator sections for data integrations. Ported from
// @workos-inc/widgets (MIT, Copyright (c) 2024 WorkOS),
// src/widgets/pipes/pipes.tsx (PipesSections) and
// src/widgets/pipes-admin/pipes-admin.tsx (PipesAdminSections).

import { Button } from "@preprocess/ui/components/button";
import {
  DropdownContent,
  DropdownMenu,
  DropdownTrigger,
} from "@preprocess/ui/components/dropdown";
import { MenuItem } from "@preprocess/ui/components/menu-item";
import { ShareUpRight } from "@preprocess/ui/lib/icons";
import { cn } from "@preprocess/ui/lib/utils";
import { useState, type ReactNode } from "react";

import {
  SettingsEmpty,
  SettingsRow,
  SettingsRowMenu,
  SettingsRows,
  SettingsSection,
  SettingsStatus,
  type SettingsMenuAction,
} from "../kit";
import { useOpenAuthorizeUrl, type ConnectHandler } from "./authorize";
import {
  ApiKeyDialog,
  ClientCredentialsDialog,
  ConfigureIntegrationDialog,
  ConnectDialog,
  DisconnectDialog,
  ProviderTile,
  RenameConnectionDialog,
} from "./dialogs";
import {
  CONNECT_AUTH_METHODS,
  addConnectionMethods,
  canRenameConnections,
  connectionLabel,
  connectionTarget,
  createAddTarget,
  organizationIntegrationConfiguration,
  unpinnedInstallationFields,
  type AuthMethod,
  type Connection,
  type ConnectionOwner,
  type ConnectionTarget,
  type Integration,
  type OrganizationIntegration,
  type SharedIntegration,
} from "./model";

// ── Shared row parts ─────────────────────────────────────

const METHOD_LABELS: Record<AuthMethod, string> = {
  oauth: "Sign in with OAuth",
  client_credentials: "Enter client credentials",
  api_key: "Enter API key",
};

function ConnectionFailedStatus() {
  return <SettingsStatus state="error">Connection failed</SettingsStatus>;
}

function ConnectedViaStatus({ method }: { method: AuthMethod }) {
  return (
    <SettingsStatus state="success">
      {method === "api_key"
        ? "Connected via API key"
        : method === "client_credentials"
          ? "Connected via client credentials"
          : "Connected via OAuth"}
    </SettingsStatus>
  );
}

/** A provider row, or a connection nested under its provider. */
function IntegrationRow({
  integration,
  name = integration.name,
  nested = false,
  status,
  description,
  dimmed = false,
  actions,
}: {
  integration: Parameters<typeof ProviderTile>[0]["integration"] & {
    name: string;
  };
  name?: string;
  nested?: boolean;
  status?: ReactNode;
  description?: ReactNode;
  dimmed?: boolean;
  actions?: ReactNode;
}) {
  return (
    <SettingsRow
      className={nested ? "pl-11" : undefined}
      description={description}
      label={
        <span
          className={cn(
            "flex flex-wrap items-center gap-2",
            dimmed && "text-muted-foreground",
          )}
        >
          <span className="truncate">{name}</span>
          {status}
        </span>
      }
      leading={
        nested ? undefined : (
          <span className={cn(dimmed && "opacity-60")}>
            <ProviderTile integration={integration} />
          </span>
        )
      }
    >
      {actions}
    </SettingsRow>
  );
}

/** A button that offers one or more connect methods. */
function MethodButton({
  label,
  methods,
  onSelect,
}: {
  label: string;
  methods: AuthMethod[];
  onSelect: (method: AuthMethod) => void;
}) {
  const [first] = methods;
  if (!first) return null;
  if (methods.length === 1) {
    return (
      <Button
        onClick={() => onSelect(first)}
        trailingIcon={first === "oauth" ? ShareUpRight : undefined}
        type="button"
        variant="secondary"
      >
        {label}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownTrigger
        render={
          <Button type="button" variant="secondary">
            {label}
          </Button>
        }
      />
      <DropdownContent align="end">
        {methods.map((method, index) => (
          <MenuItem
            icon={method === "oauth" ? ShareUpRight : undefined}
            index={index}
            key={method}
            label={METHOD_LABELS[method]}
            onSelect={() => onSelect(method)}
          />
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}

/** "Connect another account" menu rows, one per method when there are several. */
function addAnotherActions(
  methods: AuthMethod[],
  onSelect: (method: AuthMethod) => void,
): SettingsMenuAction[] {
  if (methods.length === 0) return [];
  if (methods.length === 1) {
    const [method] = methods;
    return method
      ? [
          {
            label: "Connect another account",
            icon: method === "oauth" ? ShareUpRight : undefined,
            onSelect: () => onSelect(method),
          },
        ]
      : [];
  }
  return methods.map((method) => ({
    label: `Connect another account · ${METHOD_LABELS[method]}`,
    icon: method === "oauth" ? ShareUpRight : undefined,
    onSelect: () => onSelect(method),
  }));
}

type Flow = {
  method: AuthMethod;
  target: ConnectionTarget | undefined;
  connection: Connection | null;
  collectName: boolean;
};

/**
 * The connect dialogs one row can open. `flow` picks which, and for which
 * connection: a repair of an existing one, or a new one (Add).
 */
function ConnectFlowDialogs({
  integration,
  owner,
  flow,
  onClose,
  onConnect,
  onSuccess,
}: {
  integration: Integration;
  owner: ConnectionOwner;
  flow: Flow | null;
  onClose: () => void;
  onConnect: ConnectHandler;
  onSuccess: () => void;
}) {
  if (!flow) return null;
  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };
  if (flow.method === "api_key") {
    return (
      <ApiKeyDialog
        collectName={flow.collectName}
        connection={flow.connection}
        integration={integration}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        open
        owner={owner}
        target={flow.target}
      />
    );
  }
  if (flow.method === "client_credentials") {
    return (
      <ClientCredentialsDialog
        collectName={flow.collectName}
        connection={flow.connection}
        fields={unpinnedInstallationFields(integration)}
        integration={integration}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        open
        owner={owner}
        target={flow.target}
      />
    );
  }
  return (
    <ConnectDialog
      collectName={flow.collectName}
      fields={unpinnedInstallationFields(integration)}
      integration={integration}
      onConnect={onConnect}
      onOpenChange={onOpenChange}
      open
    />
  );
}

/**
 * Repair and add flows for one row. Repairs write `connection`; adds create
 * a new connection with a fresh idempotency key.
 */
function useRowFlows(
  integration: Integration,
  owner: ConnectionOwner,
  connection: Connection | undefined,
) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const repair = useOpenAuthorizeUrl(
    integration.id,
    owner,
    connectionTarget(connection),
  );
  const add = useOpenAuthorizeUrl(integration.id, owner, { intent: "Add" });
  const isAdd = flow?.target?.intent === "Add";
  const failed = repair.connectionError ?? add.connectionError;

  const clear = () => {
    repair.clearConnectionError();
    add.clearConnectionError();
  };

  /** Repair `connection` (or connect the first one) with `method`. */
  const startRepair = async (method: AuthMethod) => {
    clear();
    // OAuth with nothing to collect skips the dialog, like the widgets.
    if (
      method === "oauth" &&
      connection &&
      unpinnedInstallationFields(integration).length === 0
    ) {
      try {
        await repair.openAuthorizeUrl();
      } catch {
        // The failure surfaces as the row's status.
      }
      return;
    }
    setFlow({
      method,
      target: connectionTarget(connection),
      connection: connection ?? null,
      collectName: false,
    });
  };

  const startAdd = (method: AuthMethod) => {
    clear();
    setFlow({
      method,
      target: createAddTarget(),
      connection: null,
      collectName: true,
    });
  };

  const dialogs = (
    <ConnectFlowDialogs
      flow={flow}
      integration={integration}
      onClose={() => setFlow(null)}
      onConnect={isAdd ? add.openAuthorizeUrl : repair.openAuthorizeUrl}
      onSuccess={clear}
      owner={owner}
    />
  );

  return { dialogs, failed, clear, startRepair, startAdd };
}

// ── Member: your connections ─────────────────────────────

function memberStatus(connection: Connection, failed: boolean) {
  if (failed) return <ConnectionFailedStatus />;
  if (connection.state === "connected") {
    return <ConnectedViaStatus method={connection.authMethod} />;
  }
  return (
    <SettingsStatus state="warning">
      {connection.authMethod === "api_key"
        ? "Update your API key"
        : "Requires reauthorization"}
    </SettingsStatus>
  );
}

/** Repair button plus the ⋯ menu for one of the member's connections. */
function MemberConnectionActions({
  integration,
  connection,
  label,
  flows,
}: {
  integration: Integration;
  connection: Connection;
  label: string;
  flows: ReturnType<typeof useRowFlows>;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const connected = connection.state === "connected";
  const method = connection.authMethod;

  const actions: SettingsMenuAction[] = [];
  if (connected && method === "api_key") {
    actions.push({
      label: "Rotate API key",
      onSelect: () => void flows.startRepair("api_key"),
    });
  }
  if (connected && method === "client_credentials") {
    actions.push({
      label: "Update client credentials",
      onSelect: () => void flows.startRepair("client_credentials"),
    });
  }
  if (canRenameConnections(integration)) {
    actions.push({ label: "Rename", onSelect: () => setRenameOpen(true) });
  }
  actions.push(
    ...addAnotherActions(
      addConnectionMethods(integration.capabilities),
      (next) => flows.startAdd(next),
    ),
  );
  actions.push({
    label: "Disconnect account",
    onSelect: () => setDisconnectOpen(true),
  });

  return (
    <>
      {renameOpen ? (
        <RenameConnectionDialog
          connection={connection}
          integrationName={integration.name}
          onOpenChange={setRenameOpen}
          open
        />
      ) : null}
      <DisconnectDialog
        connectionId={connection.id}
        integrationName={label}
        onOpenChange={setDisconnectOpen}
        onSuccess={flows.clear}
        open={disconnectOpen}
        owner="user"
      />
      {!connected ? (
        <Button
          onClick={() => void flows.startRepair(method)}
          trailingIcon={method === "oauth" ? ShareUpRight : undefined}
          type="button"
          variant="secondary"
        >
          {method === "api_key"
            ? "Update key"
            : method === "client_credentials"
              ? "Update credentials"
              : "Reauthorize"}
        </Button>
      ) : null}
      <SettingsRowMenu actions={actions} label="Pipe actions" />
    </>
  );
}

/** A provider with at most one of the member's connections. */
function MemberIntegrationItem({ integration }: { integration: Integration }) {
  const connection = integration.connections[0];
  const flows = useRowFlows(integration, "user", connection);
  const methods = CONNECT_AUTH_METHODS.filter((method) =>
    integration.authMethods.includes(method),
  );
  return (
    <>
      {flows.dialogs}
      <IntegrationRow
        actions={
          connection ? (
            <MemberConnectionActions
              connection={connection}
              flows={flows}
              integration={integration}
              label={integration.name}
            />
          ) : (
            <MethodButton
              label="Connect"
              methods={methods.length ? methods : ["oauth"]}
              onSelect={(method) => void flows.startRepair(method)}
            />
          )
        }
        description={integration.description}
        integration={integration}
        status={
          connection ? (
            memberStatus(connection, Boolean(flows.failed))
          ) : flows.failed ? (
            <ConnectionFailedStatus />
          ) : (
            <SettingsStatus state="neutral">Not connected</SettingsStatus>
          )
        }
      />
    </>
  );
}

/** One connection nested under a provider that groups several. */
function MemberNestedConnection({
  integration,
  connection,
  onAdd,
}: {
  integration: Integration;
  connection: Connection;
  onAdd: (method: AuthMethod) => void;
}) {
  const flows = useRowFlows(integration, "user", connection);
  const label = connectionLabel(integration.name, connection);
  return (
    <>
      {flows.dialogs}
      <IntegrationRow
        actions={
          <MemberConnectionActions
            connection={connection}
            flows={{ ...flows, startAdd: onAdd }}
            integration={integration}
            label={label}
          />
        }
        integration={integration}
        name={label}
        nested
        status={memberStatus(connection, Boolean(flows.failed))}
      />
    </>
  );
}

/** A provider grouping two or more of the member's connections. */
function MemberIntegrationGroup({ integration }: { integration: Integration }) {
  const flows = useRowFlows(integration, "user", undefined);
  return (
    <>
      {flows.dialogs}
      <IntegrationRow
        actions={
          <MethodButton
            label="Add connection"
            methods={addConnectionMethods(integration.capabilities)}
            onSelect={flows.startAdd}
          />
        }
        description={integration.description}
        integration={integration}
        status={
          flows.failed ? (
            <ConnectionFailedStatus />
          ) : (
            <SettingsStatus state="neutral">
              {integration.connections.length} connections
            </SettingsStatus>
          )
        }
      />
      {integration.connections.map((connection) => (
        <MemberNestedConnection
          connection={connection}
          integration={integration}
          key={connection.id}
          onAdd={flows.startAdd}
        />
      ))}
    </>
  );
}

export function MemberConnectionsSection({
  integrations,
}: {
  integrations: Integration[];
}) {
  return (
    <SettingsSection title="Your connections">
      {integrations.length > 0 ? (
        <SettingsRows>
          {integrations.map((integration) =>
            integration.connections.length > 1 ? (
              <MemberIntegrationGroup
                integration={integration}
                key={integration.id}
              />
            ) : (
              <MemberIntegrationItem
                integration={integration}
                key={integration.id}
              />
            ),
          )}
        </SettingsRows>
      ) : (
        <SettingsEmpty
          description="No integrations are available yet."
          title="No integrations"
        />
      )}
    </SettingsSection>
  );
}

// ── Member: shared connections (read-only) ───────────────

function sharedDescription(organizationName: string | undefined) {
  return organizationName
    ? `Accounts ${organizationName} owns and shares with everyone.`
    : "Accounts your organization owns and shares with everyone.";
}

export function SharedConnectionsSection({
  integrations,
  organizationName,
}: {
  integrations: SharedIntegration[];
  organizationName?: string;
}) {
  if (integrations.length === 0) return null;
  return (
    <SettingsSection
      description={sharedDescription(organizationName)}
      title="Shared connections"
    >
      <SettingsRows>
        {integrations.map((integration) => {
          const available = integration.connections.some(
            (connection) => connection.availability === "available",
          );
          return (
            <IntegrationRow
              description={integration.description}
              integration={integration}
              key={integration.id}
              status={
                available ? (
                  <SettingsStatus state="success">Available</SettingsStatus>
                ) : (
                  <SettingsStatus state="warning">
                    Needs admin attention
                  </SettingsStatus>
                )
              }
            />
          );
        })}
      </SettingsRows>
    </SettingsSection>
  );
}

// ── Admin: organization-owned connections ────────────────

function disabledStatus(integration: OrganizationIntegration) {
  return (
    <SettingsStatus state="neutral">
      {integration.disabledSource === "developer"
        ? "Disabled by developer"
        : "Disabled for your organization"}
    </SettingsStatus>
  );
}

/** The method a new organization connection uses. */
function organizationConnectMethod(
  integration: OrganizationIntegration,
): AuthMethod {
  const methods = integration.authMethods;
  if (methods.includes("oauth") && integration.configured) return "oauth";
  if (methods.includes("client_credentials")) return "client_credentials";
  if (methods.includes("api_key")) return "api_key";
  return "oauth";
}

/** The Add the provider allows, or a write to its compatibility slot. */
function organizationAddAction(
  integration: OrganizationIntegration,
): { method: AuthMethod; add: boolean } | null {
  const [method] = addConnectionMethods(integration.capabilities);
  if (method) return { method, add: true };
  if (
    integration.organizationCapabilities.canConnect &&
    integration.connections.length > 0
  ) {
    return { method: organizationConnectMethod(integration), add: false };
  }
  return null;
}

/** One organization-owned connection (or the empty slot), with its actions. */
function SharedAccountRow({
  integration,
  connection,
  nested = false,
  onAdd,
}: {
  integration: OrganizationIntegration;
  connection: Connection | undefined;
  nested?: boolean;
  onAdd?: (method: AuthMethod) => void;
}) {
  const flows = useRowFlows(integration, "organization", connection);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const capabilities = integration.organizationCapabilities;
  const method =
    connection?.authMethod ?? organizationConnectMethod(integration);
  const needsAttention =
    connection !== undefined && connection.state !== "connected";
  const label = connection
    ? connectionLabel(integration.name, connection)
    : integration.name;
  const repair = connection?.capabilities ?? capabilities;
  const showConnect = connection
    ? method === "oauth"
      ? repair.canReauthorize
      : repair.canUpdateCredentials
    : capabilities.canConnect;
  const showDisconnect = connection !== undefined && capabilities.canDisconnect;
  const showRename =
    connection !== undefined &&
    integration.disabledSource !== "developer" &&
    canRenameConnections(integration);
  const addAction =
    connection !== undefined && !needsAttention
      ? organizationAddAction(integration)
      : null;
  const connectLabel = !connection
    ? "Connect"
    : method === "api_key"
      ? needsAttention
        ? "Update API key"
        : "Rotate API key"
      : method === "client_credentials"
        ? "Update client credentials"
        : "Reauthorize";

  const promoted =
    showConnect && (!connection || needsAttention) ? (
      <Button
        onClick={() => void flows.startRepair(method)}
        trailingIcon={method === "oauth" ? ShareUpRight : undefined}
        type="button"
        variant="secondary"
      >
        {connectLabel}
      </Button>
    ) : capabilities.canConfigure &&
      !nested &&
      !connection &&
      integration.enabled ? (
      <Button
        onClick={() => setConfigureOpen(true)}
        type="button"
        variant="secondary"
      >
        Configure
      </Button>
    ) : null;

  const menu: SettingsMenuAction[] = [];
  if (showConnect && connection && !needsAttention) {
    menu.push({
      label: connectLabel,
      icon: method === "oauth" ? ShareUpRight : undefined,
      onSelect: () => void flows.startRepair(method),
    });
  }
  if (
    capabilities.canConfigure &&
    !nested &&
    !(promoted && !showConnect && !connection)
  ) {
    menu.push({ label: "Configure", onSelect: () => setConfigureOpen(true) });
  }
  if (showRename)
    menu.push({ label: "Rename", onSelect: () => setRenameOpen(true) });
  if (addAction) {
    menu.push({
      label: "Connect another account",
      icon: addAction.method === "oauth" ? ShareUpRight : undefined,
      onSelect: () =>
        addAction.add
          ? (onAdd ?? flows.startAdd)(addAction.method)
          : void flows.startRepair(addAction.method),
    });
  }
  if (showDisconnect) {
    menu.push({ label: "Disconnect", onSelect: () => setDisconnectOpen(true) });
  }

  const needsOrganizationCredentials =
    integration.enabled &&
    !connection &&
    integration.credentials.credentialsType === "organization" &&
    !integration.configured;

  const status = !integration.enabled ? (
    nested ? null : (
      disabledStatus(integration)
    )
  ) : flows.failed ? (
    <ConnectionFailedStatus />
  ) : !connection ? null : connection.state === "connected" ? (
    <ConnectedViaStatus method={method} />
  ) : (
    <SettingsStatus state="warning">Needs attention</SettingsStatus>
  );

  return (
    <>
      {flows.dialogs}
      {configureOpen ? (
        <ConfigureIntegrationDialog
          integration={organizationIntegrationConfiguration(integration)}
          onOpenChange={setConfigureOpen}
          open
          owner="organization"
        />
      ) : null}
      {connection && renameOpen ? (
        <RenameConnectionDialog
          connection={connection}
          integrationName={integration.name}
          onOpenChange={setRenameOpen}
          open
          owner="organization"
        />
      ) : null}
      {connection ? (
        <DisconnectDialog
          connectionId={connection.id}
          integrationName={label}
          onOpenChange={setDisconnectOpen}
          onSuccess={flows.clear}
          open={disconnectOpen}
          owner="organization"
        />
      ) : null}
      <IntegrationRow
        actions={
          <>
            {promoted}
            {menu.length > 0 ? (
              <SettingsRowMenu actions={menu} label="More actions" />
            ) : null}
          </>
        }
        description={
          nested
            ? null
            : needsOrganizationCredentials
              ? "Enter your organization's OAuth client to make this connectable."
              : integration.description
        }
        dimmed={!integration.enabled}
        integration={integration}
        name={nested ? label : integration.name}
        nested={nested}
        status={status}
      />
    </>
  );
}

/** An organization-owned provider grouping several connections. */
function SharedAccountGroup({
  integration,
}: {
  integration: OrganizationIntegration;
}) {
  const flows = useRowFlows(integration, "organization", undefined);
  const [configureOpen, setConfigureOpen] = useState(false);
  const capabilities = integration.organizationCapabilities;
  const addAction = organizationAddAction(integration);
  return (
    <>
      {flows.dialogs}
      {configureOpen ? (
        <ConfigureIntegrationDialog
          integration={organizationIntegrationConfiguration(integration)}
          onOpenChange={setConfigureOpen}
          open
          owner="organization"
        />
      ) : null}
      <IntegrationRow
        actions={
          <>
            {addAction ? (
              <Button
                onClick={() =>
                  addAction.add
                    ? flows.startAdd(addAction.method)
                    : void flows.startRepair(addAction.method)
                }
                trailingIcon={
                  addAction.method === "oauth" ? ShareUpRight : undefined
                }
                type="button"
                variant="secondary"
              >
                Add connection
              </Button>
            ) : null}
            {capabilities.canConfigure ? (
              <Button
                onClick={() => setConfigureOpen(true)}
                type="button"
                variant={integration.enabled ? "ghost" : "secondary"}
              >
                Configure
              </Button>
            ) : null}
          </>
        }
        description={integration.description}
        dimmed={!integration.enabled}
        integration={integration}
        status={
          !integration.enabled ? (
            disabledStatus(integration)
          ) : flows.failed ? (
            <ConnectionFailedStatus />
          ) : (
            <SettingsStatus state="neutral">
              {integration.connections.length} connections
            </SettingsStatus>
          )
        }
      />
      {integration.connections.map((connection) => (
        <SharedAccountRow
          connection={connection}
          integration={integration}
          key={connection.id}
          nested
          onAdd={flows.startAdd}
        />
      ))}
    </>
  );
}

export function SharedConnectionsAdminSection({
  integrations,
  organizationName,
}: {
  integrations: OrganizationIntegration[];
  organizationName?: string;
}) {
  if (integrations.length === 0) return null;
  return (
    <SettingsSection
      description={sharedDescription(organizationName)}
      title="Shared connections"
    >
      <SettingsRows>
        {integrations.map((integration) =>
          integration.connections.length > 1 ? (
            <SharedAccountGroup
              integration={integration}
              key={integration.id}
            />
          ) : (
            <SharedAccountRow
              connection={integration.connections[0]}
              integration={integration}
              key={integration.id}
            />
          ),
        )}
      </SettingsRows>
    </SettingsSection>
  );
}
