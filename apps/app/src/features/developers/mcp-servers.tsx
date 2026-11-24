import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  CheckboxGroup,
  CheckboxItem,
} from "@preprocess/ui/components/checkbox-group";
import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { Switch } from "@preprocess/ui/components/switch";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  Lock,
  Pencil,
  Plus,
  WrenchScrewdriver,
  X,
} from "@preprocess/ui/lib/icons";
import { SizeProvider } from "@preprocess/ui/lib/size-context";
import { useRef, useState, type FormEvent } from "react";

import {
  SettingsConfirmDialog,
  SettingsDialogActions,
  SettingsDialogShell,
  SettingsEmpty,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRowMenu,
  SettingsRows,
  SettingsSection,
  actionErrorMessage,
} from "../settings/kit";
import type {
  McpAuthKind,
  McpServerInput,
  McpServerSummary,
} from "./platform-store";

/** An organization server turned on for an agent, as the agent page sees it. */
export type McpGrant = {
  readonly serverId: string;
  /** null allows every tool. */
  readonly tools: readonly string[] | null;
};

const AUTH_LABEL: Record<McpAuthKind, string> = {
  none: "No auth",
  oauth: "OAuth",
  token: "Bearer token",
};

const AUTH_KINDS = Object.keys(AUTH_LABEL) as McpAuthKind[];

function isAuthKind(value: string): value is McpAuthKind {
  return value in AUTH_LABEL;
}

function validateName(value: string) {
  return value.trim() ? null : "Enter a name, like Inventory.";
}

function validateUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Enter the server's URL.";
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? null : "Use an https:// URL.";
  } catch {
    return "Enter a full URL, like https://mcp.example.com.";
  }
}

function ServerName({ name }: Readonly<{ name: string }>) {
  return (
    <span
      className="truncate text-body text-foreground"
      style={{ fontVariationSettings: fontWeights.semibold }}
    >
      {name}
    </span>
  );
}

function AuthBadge({ auth }: Readonly<{ auth: McpAuthKind }>) {
  return (
    <Badge className="shrink-0" size="sm">
      {AUTH_LABEL[auth]}
    </Badge>
  );
}

function OrganizationBadge() {
  return (
    <Badge className="shrink-0" size="sm">
      <span className="flex items-center gap-1">
        <Lock aria-hidden="true" className="size-3" />
        Organization
      </span>
    </Badge>
  );
}

function toolCount(count: number) {
  return count === 1 ? "1 tool" : `${count} tools`;
}

/** "4 tools", or a note that the server hasn't reported any yet. */
function toolsSummary(server: McpServerSummary) {
  return server.tools.length > 0
    ? toolCount(server.tools.length)
    : "No tools reported yet";
}

/** Adds a server, or edits one; a saved token is never shown again. */
function McpServerDialog({
  open,
  onOpenChange,
  server,
  names,
  onSave,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The server being edited, or null to add one. */
  server: McpServerSummary | null;
  /** Names already taken where this server would show up. */
  names: readonly string[];
  onSave: (input: McpServerInput) => Promise<unknown>;
}>) {
  const nameRef = useRef<InlineValidationHandle>(null);
  const urlRef = useRef<InlineValidationHandle>(null);
  const tokenRef = useRef<InlineValidationHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [auth, setAuth] = useState<McpAuthKind>(server?.auth ?? "oauth");
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Editing a token server, an empty field keeps the saved token.
  const keepsToken = server?.auth === "token";
  const taken = new Set(
    names
      .filter((item) => item !== server?.name)
      .map((item) => item.toLowerCase()),
  );

  async function save() {
    setError(null);
    const ok = [
      nameRef.current?.commit(),
      urlRef.current?.commit(),
      auth === "token" ? tokenRef.current?.commit() : true,
    ];
    if (!ok.every(Boolean)) throw new AsyncActionAbortError();
    try {
      await onSave({ name: name.trim(), url: url.trim(), auth, token });
      window.setTimeout(() => onOpenChange(false), 400);
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not save the server."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      onOpenChange={onOpenChange}
      open={open}
      title={server ? `Edit ${server.name}` : "Add MCP server"}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        <InlineValidation
          autoFocus
          id="mcp-name"
          label="Name"
          onChange={setName}
          placeholder="Inventory"
          ref={nameRef}
          validate={(value) =>
            validateName(value) ??
            (taken.has(value.trim().toLowerCase())
              ? "A server already has this name."
              : null)
          }
          value={name}
        />
        <InlineValidation
          hint="A remote server over streamable HTTP."
          id="mcp-url"
          label="URL"
          onChange={setUrl}
          placeholder="https://mcp.example.com"
          ref={urlRef}
          type="url"
          validate={validateUrl}
          value={url}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-body text-foreground">Authentication</span>
          <Select
            onValueChange={(value) => {
              if (isAuthKind(value)) setAuth(value);
            }}
            value={auth}
          >
            <SelectTrigger aria-label="Authentication" />
            <SelectContent>
              {AUTH_KINDS.map((kind, index) => (
                <SelectItem index={index} key={kind} value={kind}>
                  {AUTH_LABEL[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {auth === "token" ? (
          <InlineValidation
            hint={
              keepsToken
                ? "Leave empty to keep the saved token."
                : "Sent as the Authorization header. Stored encrypted."
            }
            id="mcp-token"
            label="Token"
            onChange={setToken}
            ref={tokenRef}
            type="password"
            validate={(value) =>
              value || keepsToken ? null : "Enter the server's token."
            }
            value={token}
          />
        ) : null}
        {auth === "oauth" && server?.auth !== "oauth" ? (
          <SettingsPanelMessage>
            After saving, sign in to the server once for the organization.
          </SettingsPanelMessage>
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
            pendingLabel="Saving…"
            ref={saveRef}
            successLabel="Saved"
            type="submit"
          >
            {server ? "Save" : "Add server"}
          </LoadingButton>
        </SettingsDialogActions>
      </form>
    </SettingsDialogShell>
  );
}

/** Picks which of a server's tools one agent may call. */
function ToolsDialog({
  open,
  onOpenChange,
  server,
  selected,
  onSave,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: McpServerSummary;
  selected: readonly string[] | null;
  onSave: (tools: readonly string[] | null) => Promise<unknown>;
}>) {
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [all, setAll] = useState(selected === null);
  const [tools, setTools] = useState<readonly string[]>(
    selected ?? server.tools.map((tool) => tool.name),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checked = new Set(
    server.tools.flatMap((tool, index) =>
      tools.includes(tool.name) ? [index] : [],
    ),
  );

  async function save() {
    setError(null);
    if (!all && tools.length === 0) {
      setError("Choose at least one tool, or turn the server off instead.");
      throw new AsyncActionAbortError();
    }
    try {
      await onSave(all ? null : tools);
      window.setTimeout(() => onOpenChange(false), 400);
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not save the tools."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      onOpenChange={onOpenChange}
      open={open}
      title={`${server.name} tools`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        <Switch
          checked={all}
          label="Allow every tool, including ones the server adds later"
          onToggle={() => setAll((current) => !current)}
        />
        {all ? null : (
          <ScrollArea className="max-h-64" viewportClassName="scroll-fade">
            <CheckboxGroup checkedIndices={checked}>
              {server.tools.map((tool, index) => (
                <CheckboxItem
                  checked={tools.includes(tool.name)}
                  index={index}
                  key={tool.name}
                  label={tool.name}
                  onToggle={() =>
                    setTools((current) =>
                      current.includes(tool.name)
                        ? current.filter((name) => name !== tool.name)
                        : [...current, tool.name],
                    )
                  }
                />
              ))}
            </CheckboxGroup>
          </ScrollArea>
        )}
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
            pendingLabel="Saving…"
            ref={saveRef}
            successLabel="Saved"
            type="submit"
          >
            Save
          </LoadingButton>
        </SettingsDialogActions>
      </form>
    </SettingsDialogShell>
  );
}

function AddServerButton({ onClick }: Readonly<{ onClick: () => void }>) {
  return (
    <Button
      leadingIcon={Plus}
      onClick={onClick}
      size="compact"
      type="button"
      variant="secondary"
    >
      Add server
    </Button>
  );
}

function useServerDialogs() {
  const [editing, setEditing] = useState<
    { mode: "add" } | { mode: "edit"; server: McpServerSummary } | null
  >(null);
  const [deleting, setDeleting] = useState<McpServerSummary | null>(null);
  return { editing, setEditing, deleting, setDeleting };
}

function serverActions(
  server: McpServerSummary,
  dialogs: ReturnType<typeof useServerDialogs>,
) {
  return [
    {
      label: "Edit",
      icon: Pencil,
      onSelect: () => dialogs.setEditing({ mode: "edit", server }),
    },
    { label: "Delete", icon: X, onSelect: () => dialogs.setDeleting(server) },
  ];
}

/**
 * The organization's MCP servers. Agents don't get any of them until
 * they're turned on in the agent's settings.
 */
export function OrgMcpSection({
  servers,
  usage,
  onSave,
  onDelete,
}: Readonly<{
  servers: readonly McpServerSummary[];
  /** Agents that turned each server on, by id. */
  usage: Readonly<Record<string, number>>;
  onSave: (input: McpServerInput, id?: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}>) {
  const dialogs = useServerDialogs();
  const { editing, setEditing, deleting, setDeleting } = dialogs;
  const deletingUsage = deleting ? (usage[deleting.id] ?? 0) : 0;

  return (
    <SettingsSection
      actions={<AddServerButton onClick={() => setEditing({ mode: "add" })} />}
      description="Remote MCP servers agents can call as tools. Each one stays off for an agent until it's turned on in that agent's settings."
      title="MCP servers"
    >
      {servers.length === 0 ? (
        <SettingsEmpty
          description="Add a server, then turn it on for the agents that need it."
          title="No MCP servers yet"
        />
      ) : (
        <SettingsRows>
          {servers.map((server) => {
            const agents = usage[server.id] ?? 0;
            return (
              <SettingsRow
                description={`${server.url} · ${toolsSummary(server)}`}
                key={server.id}
                label={<ServerName name={server.name} />}
              >
                <span className="text-caption text-muted-foreground">
                  {agents === 0
                    ? "No agents"
                    : agents === 1
                      ? "1 agent"
                      : `${agents} agents`}
                </span>
                <AuthBadge auth={server.auth} />
                <SettingsRowMenu
                  actions={serverActions(server, dialogs)}
                  label={`Actions for ${server.name}`}
                />
              </SettingsRow>
            );
          })}
        </SettingsRows>
      )}
      {editing ? (
        <McpServerDialog
          key={editing.mode === "edit" ? editing.server.id : "add"}
          names={servers.map((server) => server.name)}
          onOpenChange={(open) => (open ? undefined : setEditing(null))}
          onSave={(input) =>
            onSave(
              input,
              editing.mode === "edit" ? editing.server.id : undefined,
            )
          }
          open
          server={editing.mode === "edit" ? editing.server : null}
        />
      ) : null}
      <SettingsConfirmDialog
        confirmLabel="Delete"
        description={
          deletingUsage > 0
            ? `${deletingUsage === 1 ? "1 agent loses" : `${deletingUsage} agents lose`} its tools on the next run.`
            : "No agents use it."
        }
        onConfirm={() => (deleting ? onDelete(deleting.id) : Promise.resolve())}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        open={deleting !== null}
        pendingLabel="Deleting…"
        successLabel="Deleted"
        title={deleting ? `Delete ${deleting.name}?` : "Delete"}
      />
    </SettingsSection>
  );
}

/**
 * One agent's MCP servers: the organization's, each off until turned on
 * here and optionally narrowed to some tools, then servers only this
 * agent uses.
 */
export function AgentMcpSection({
  title,
  organization,
  grants,
  servers,
  onEnable,
  onTools,
  onSave,
  onDelete,
}: Readonly<{
  /** Set when the section shares a page with others. */
  title?: string;
  organization: readonly McpServerSummary[];
  grants: readonly McpGrant[];
  /** The agent's own servers. */
  servers: readonly McpServerSummary[];
  onEnable: (serverId: string, enabled: boolean) => Promise<unknown>;
  onTools: (
    serverId: string,
    tools: readonly string[] | null,
  ) => Promise<unknown>;
  onSave: (input: McpServerInput, id?: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}>) {
  const dialogs = useServerDialogs();
  const { editing, setEditing, deleting, setDeleting } = dialogs;
  const [choosing, setChoosing] = useState<McpServerSummary | null>(null);
  const grantFor = (id: string) =>
    grants.find((grant) => grant.serverId === id) ?? null;
  const enabledCount =
    organization.filter((server) => grantFor(server.id)).length +
    servers.length;

  return (
    <SettingsSection
      actions={<AddServerButton onClick={() => setEditing({ mode: "add" })} />}
      description={`${
        enabledCount === 0
          ? "This agent calls no MCP servers."
          : `This agent calls ${enabledCount === 1 ? "1 server" : `${enabledCount} servers`}.`
      } Organization servers, managed in Developers → MCP servers, are off until turned on here. Servers added here are this agent's alone.`}
      title={title}
    >
      {organization.length + servers.length === 0 ? (
        <SettingsEmpty
          description="Add a server here, or in Developers → MCP servers for the whole organization."
          title="No MCP servers yet"
        />
      ) : (
        <SettingsRows>
          {servers.map((server) => (
            <SettingsRow
              description={`This agent only · ${toolsSummary(server)}`}
              key={`agent:${server.id}`}
              label={<ServerName name={server.name} />}
            >
              <AuthBadge auth={server.auth} />
              <SettingsRowMenu
                actions={serverActions(server, dialogs)}
                label={`Actions for ${server.name}`}
              />
            </SettingsRow>
          ))}
          {organization.map((server) => {
            const grant = grantFor(server.id);
            const tools = grant?.tools;
            return (
              <SettingsRow
                description={
                  grant
                    ? tools
                      ? `From the organization · ${tools.length} of ${toolCount(server.tools.length)}`
                      : `From the organization · all ${toolCount(server.tools.length)}`
                    : `From the organization · ${toolsSummary(server)}`
                }
                key={`org:${server.id}`}
                label={<ServerName name={server.name} />}
              >
                <OrganizationBadge />
                <SizeProvider size="compact">
                  <Switch
                    checked={grant !== null}
                    label={grant ? "On" : "Off"}
                    onToggle={() => void onEnable(server.id, grant === null)}
                  />
                </SizeProvider>
                <SettingsRowMenu
                  actions={[
                    {
                      label: "Choose tools…",
                      icon: WrenchScrewdriver,
                      disabled: grant === null || server.tools.length === 0,
                      onSelect: () => setChoosing(server),
                    },
                  ]}
                  label={`Actions for ${server.name}`}
                />
              </SettingsRow>
            );
          })}
        </SettingsRows>
      )}
      {editing ? (
        <McpServerDialog
          key={editing.mode === "edit" ? editing.server.id : "add"}
          names={[...organization, ...servers].map((server) => server.name)}
          onOpenChange={(open) => (open ? undefined : setEditing(null))}
          onSave={(input) =>
            onSave(
              input,
              editing.mode === "edit" ? editing.server.id : undefined,
            )
          }
          open
          server={editing.mode === "edit" ? editing.server : null}
        />
      ) : null}
      {choosing ? (
        <ToolsDialog
          key={choosing.id}
          onOpenChange={(open) => (open ? undefined : setChoosing(null))}
          onSave={(tools) => onTools(choosing.id, tools)}
          open
          selected={grantFor(choosing.id)?.tools ?? null}
          server={choosing}
        />
      ) : null}
      <SettingsConfirmDialog
        confirmLabel="Delete"
        description="The agent loses its tools on the next run."
        onConfirm={() => (deleting ? onDelete(deleting.id) : Promise.resolve())}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        open={deleting !== null}
        pendingLabel="Deleting…"
        successLabel="Deleted"
        title={deleting ? `Delete ${deleting.name}?` : "Delete"}
      />
    </SettingsSection>
  );
}
