import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  CheckboxGroup,
  CheckboxItem,
} from "@preprocess/ui/components/checkbox-group";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  Pencil,
  Plug,
  Plus,
  RotateCcw,
  Users,
  WrenchScrewdriver,
  X,
} from "@preprocess/ui/lib/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { McpServersArt, NoAccessArt } from "../../components/empty-art";
import {
  ValidatedField,
  type ValidatedFieldHandle,
} from "../../components/validated-field";

import { useOrganizationId } from "../auth/auth-context";
import { orgApi } from "../auth/client";
import {
  SettingsConfirmDialog,
  SettingsDialogActions,
  SettingsDialogShell,
  SettingsEmpty,
  SettingsError,
  SettingsPanelMessage,
  SettingsRow,
  SettingsRowMenu,
  SettingsRows,
  SettingsSection,
  SettingsSkeletonRows,
  SettingsStatus,
  actionErrorMessage,
  formatRelative,
  type SettingsStatusState,
} from "../settings/kit";
import { useAdministers } from "../settings/use-role";

/**
 * Developers → Integrations: the organization's remote MCP servers
 * (/v1/orgs/:org/mcp-servers). The organization registers a server, signs in
 * to it once when it wants OAuth, and grants it to the agents whose code may
 * call it. Owners and Admins manage all of it.
 */

type McpServer = {
  slug: string;
  url: string;
  auth: "none" | "oauth";
  transport: "streamable_http" | "sse";
  agents: string[];
  connection: {
    status: "active" | "needs_reauth" | "revoked";
    connectedBy: string;
    updatedAt: string;
  } | null;
};

type McpTool = { name: string; description?: string };

type Agent = { slug: string; archived: boolean };

/** Where the OAuth callback sent the browser back from (?connected, ?connect_error). */
export type ConnectResult =
  { connected: string } | { connectError: "cancelled" | "expired" | "refused" };

type Notice = { tone: "muted" | "danger"; text: string };

const CONNECT_ERROR_TEXT = {
  cancelled: "The sign-in was cancelled, so nothing changed.",
  expired: "That sign-in expired. Connect again.",
  refused: "The server refused the sign-in. Connect again.",
} as const;

/** Writing's copy (PLAT-82) for a Delete that grants block. */
const DELETE_BLOCKED_TEXT = {
  title: (slug: string) => `Can't delete ${slug}`,
  body: (slug: string, count: number) =>
    count === 1
      ? `1 agent still has access to ${slug}. Revoke its grant first, then delete the server.`
      : `${count} agents still have access to ${slug}. Revoke their grants first, then delete the server.`,
} as const;

const SERVER_NAME = /^[a-z][a-z0-9-]{0,62}$/;

function validateName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Enter the name your agents' code uses, like inventory.";
  return SERVER_NAME.test(trimmed)
    ? null
    : "Use lowercase letters, numbers and dashes, starting with a letter.";
}

function validateUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Enter the server's URL.";
  try {
    return new URL(trimmed).protocol === "https:"
      ? null
      : "Use an https:// URL.";
  } catch {
    return "Enter a full URL, like https://mcp.example.com.";
  }
}

function ServerName({ name }: Readonly<{ name: string }>) {
  return (
    <span
      className="truncate text-body text-foreground"
      style={{ fontVariationSettings: fontWeights.medium }}
    >
      {name}
    </span>
  );
}

/** Rows on the dialog surface with hairline dividers, as Billing's dialogs. */
function DialogRows({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex flex-col divide-y divide-border">{children}</div>;
}

function agentCount(count: number) {
  if (count === 0) return "No agents";
  return count === 1 ? "1 agent" : `${count} agents`;
}

/** The connection's state as a status badge; null when no sign-in is needed. */
function connectionStatus(
  server: McpServer,
): { state: SettingsStatusState; label: string } | null {
  if (server.auth === "none") return null;
  switch (server.connection?.status) {
    case "active":
      return { state: "success", label: "Connected" };
    case "needs_reauth":
      return { state: "warning", label: "Needs sign-in" };
    case "revoked":
      return { state: "error", label: "Revoked" };
    default:
      return { state: "neutral", label: "Not connected" };
  }
}

/** "https://… · Connected by Ada 2 days ago"; just the URL before a sign-in. */
function serverDescription(
  server: McpServer,
  people: ReadonlyMap<string, string>,
) {
  const { connection } = server;
  if (server.auth === "none") return `${server.url} · No sign-in needed`;
  if (!connection) return server.url;
  return `${server.url} · ${connection.status === "active" ? "Connected" : "Signed in"} by ${people.get(connection.connectedBy) ?? connection.connectedBy} ${formatRelative(connection.updatedAt)}`;
}

export function McpServers({
  connectResult,
}: Readonly<{ connectResult: ConnectResult | null }>) {
  const administers = useAdministers();
  if (administers === false)
    return (
      <SettingsEmpty
        art={<NoAccessArt />}
        description="Only organization Owners and Admins can manage MCP servers."
        title="Admin access required"
      />
    );
  return (
    <McpServersSection
      connectResult={connectResult}
      roleLoading={administers === undefined}
    />
  );
}

function McpServersSection({
  connectResult,
  roleLoading,
}: Readonly<{ connectResult: ConnectResult | null; roleLoading: boolean }>) {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const queryKey = ["mcp-servers", organizationId];
  const servers = useQuery({
    queryKey,
    enabled: !roleLoading,
    queryFn: () => orgApi<McpServer[]>(organizationId, "/mcp-servers"),
  });
  const people = useQuery({
    queryKey: ["members", organizationId, "names"],
    enabled: !roleLoading,
    queryFn: () =>
      orgApi<{ userId: string; name: string }[]>(organizationId, "/members"),
    select: (members) =>
      new Map(members.map((member) => [member.userId, member.name])),
  });
  const [notice, setNotice] = useState<Notice | null>(() =>
    connectResult === null
      ? null
      : "connected" in connectResult
        ? { tone: "muted", text: `Connected to ${connectResult.connected}.` }
        : {
            tone: "danger",
            text: CONNECT_ERROR_TEXT[connectResult.connectError],
          },
  );
  const [editing, setEditing] = useState<
    { mode: "add" } | { mode: "edit"; server: McpServer } | null
  >(null);
  const [granting, setGranting] = useState<McpServer | null>(null);
  const [listing, setListing] = useState<McpServer | null>(null);
  const [disconnecting, setDisconnecting] = useState<McpServer | null>(null);
  const [deleting, setDeleting] = useState<McpServer | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const path = (server: McpServer, rest = "") =>
    `/mcp-servers/${encodeURIComponent(server.slug)}${rest}`;

  async function connect(server: McpServer) {
    setNotice(null);
    try {
      const { authorizationUrl } = await orgApi<{ authorizationUrl: string }>(
        organizationId,
        path(server, "/connect"),
        { method: "POST" },
      );
      window.location.assign(authorizationUrl);
    } catch (cause) {
      setNotice({
        tone: "danger",
        text: actionErrorMessage(cause, `Could not connect to ${server.slug}.`),
      });
      throw cause;
    }
  }

  async function refreshToken(server: McpServer) {
    setNotice(null);
    try {
      await orgApi(organizationId, path(server, "/connection/refresh"), {
        method: "POST",
      });
      setNotice({
        tone: "muted",
        text: `Refreshed the sign-in for ${server.slug}.`,
      });
    } catch (cause) {
      setNotice({
        tone: "danger",
        text: actionErrorMessage(
          cause,
          `Could not refresh the sign-in for ${server.slug}.`,
        ),
      });
    }
    await refresh();
  }

  const actions = (server: McpServer) => [
    ...(server.auth === "oauth"
      ? [
          {
            label: server.connection ? "Reconnect" : "Connect",
            icon: Plug,
            onSelect: () => void connect(server).catch(() => undefined),
          },
        ]
      : []),
    ...(server.connection
      ? [
          {
            label: "Refresh sign-in",
            icon: RotateCcw,
            disabled: server.connection.status !== "active",
            onSelect: () => void refreshToken(server),
          },
          {
            label: "Disconnect",
            icon: X,
            onSelect: () => setDisconnecting(server),
          },
        ]
      : []),
    {
      label: "Tools…",
      icon: WrenchScrewdriver,
      onSelect: () => setListing(server),
    },
    { label: "Agents…", icon: Users, onSelect: () => setGranting(server) },
    {
      label: "Change URL…",
      icon: Pencil,
      onSelect: () => setEditing({ mode: "edit", server }),
    },
    {
      label: "Delete",
      icon: X,
      onSelect: () => {
        setNotice(null);
        setDeleting(server);
      },
    },
  ];

  return (
    <SettingsSection
      actions={
        <Button
          disabled={roleLoading}
          leadingIcon={Plus}
          onClick={() => setEditing({ mode: "add" })}
          size="compact"
          type="button"
          variant="secondary"
        >
          Add server
        </Button>
      }
      description="Remote MCP servers agents can call as tools. The organization signs in to each one once, and an agent's code can use a server only after it's granted here."
      title="MCP servers"
    >
      {notice ? (
        <SettingsPanelMessage tone={notice.tone}>
          {notice.text}
        </SettingsPanelMessage>
      ) : null}
      {servers.isError ? (
        <SettingsError error={servers.error} />
      ) : servers.data === undefined ? (
        <SettingsSkeletonRows count={2} />
      ) : servers.data.length === 0 ? (
        <SettingsEmpty
          art={<McpServersArt />}
          description="Add a remote MCP server so agents can call its tools."
          title="No MCP servers yet"
        />
      ) : (
        <SettingsRows>
          {servers.data.map((server) => {
            const status = connectionStatus(server);
            const needsSignIn =
              server.auth === "oauth" && server.connection?.status !== "active";
            return (
              <SettingsRow
                description={serverDescription(
                  server,
                  people.data ?? new Map(),
                )}
                key={server.slug}
                label={<ServerName name={server.slug} />}
              >
                <span className="whitespace-nowrap text-caption text-muted-foreground">
                  {agentCount(server.agents.length)}
                </span>
                {server.transport === "sse" ? (
                  <Badge className="shrink-0" size="sm">
                    Legacy SSE
                  </Badge>
                ) : null}
                {status ? (
                  <SettingsStatus state={status.state}>
                    {status.label}
                  </SettingsStatus>
                ) : null}
                {needsSignIn ? (
                  <LoadingButton
                    className="w-auto shrink-0"
                    onAction={() => connect(server)}
                    pendingLabel="Connecting…"
                    size="compact"
                    variant="secondary"
                  >
                    {server.connection ? "Reconnect" : "Connect"}
                  </LoadingButton>
                ) : null}
                <SettingsRowMenu
                  actions={actions(server)}
                  label={`Actions for ${server.slug}`}
                />
              </SettingsRow>
            );
          })}
        </SettingsRows>
      )}
      {editing ? (
        <ServerDialog
          key={editing.mode === "edit" ? editing.server.slug : "add"}
          names={(servers.data ?? []).map((server) => server.slug)}
          onOpenChange={(open) => (open ? undefined : setEditing(null))}
          onSaved={(saved) => {
            void refresh();
            if (saved.auth === "oauth" && editing.mode === "add")
              setNotice({
                tone: "muted",
                text: `${saved.slug} asks for a sign-in. Connect it once for the organization.`,
              });
          }}
          open
          organizationId={organizationId}
          server={editing.mode === "edit" ? editing.server : null}
        />
      ) : null}
      {granting ? (
        <AgentsDialog
          key={granting.slug}
          onOpenChange={(open) => (open ? undefined : setGranting(null))}
          onSaved={() => void refresh()}
          open
          organizationId={organizationId}
          server={granting}
        />
      ) : null}
      {listing ? (
        <ToolsDialog
          onOpenChange={(open) => (open ? undefined : setListing(null))}
          open
          organizationId={organizationId}
          server={listing}
        />
      ) : null}
      <SettingsConfirmDialog
        confirmLabel="Disconnect"
        description="Agents that use it get an error until someone connects it again."
        onConfirm={async () => {
          if (!disconnecting) return;
          await orgApi(organizationId, path(disconnecting, "/connection"), {
            method: "DELETE",
          });
          await refresh();
        }}
        onOpenChange={(open) => (open ? undefined : setDisconnecting(null))}
        open={disconnecting !== null}
        pendingLabel="Disconnecting…"
        successLabel="Disconnected"
        title={`Disconnect ${disconnecting?.slug ?? "this server"}?`}
      />
      {deleting && deleting.agents.length > 0 ? (
        <SettingsDialogShell
          description={DELETE_BLOCKED_TEXT.body(
            deleting.slug,
            deleting.agents.length,
          )}
          footer={
            <Button
              onClick={() => setDeleting(null)}
              type="button"
              variant="secondary"
            >
              Close
            </Button>
          }
          onOpenChange={(open) => (open ? undefined : setDeleting(null))}
          open
          title={DELETE_BLOCKED_TEXT.title(deleting.slug)}
        >
          <DialogRows>
            {deleting.agents.map((agent) => (
              <SettingsRow key={agent} label={<ServerName name={agent} />} />
            ))}
          </DialogRows>
        </SettingsDialogShell>
      ) : null}
      <SettingsConfirmDialog
        confirmLabel="Delete"
        description="Its connection is removed too. This can't be undone."
        onConfirm={async () => {
          if (!deleting) return;
          await orgApi(organizationId, path(deleting), { method: "DELETE" });
          await refresh();
        }}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        open={deleting !== null && deleting.agents.length === 0}
        pendingLabel="Deleting…"
        successLabel="Deleted"
        title={`Delete ${deleting?.slug ?? "this server"}?`}
      />
    </SettingsSection>
  );
}

/** Registers a server, or points an existing one at a new URL. */
function ServerDialog({
  open,
  onOpenChange,
  organizationId,
  server,
  names,
  onSaved,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** The server whose URL is changing, or null to add one. */
  server: McpServer | null;
  /** Names already taken. */
  names: readonly string[];
  onSaved: (saved: { slug: string; auth: McpServer["auth"] }) => void;
}>) {
  const nameRef = useRef<ValidatedFieldHandle>(null);
  const urlRef = useRef<ValidatedFieldHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [name, setName] = useState(server?.slug ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const ok = [nameRef.current?.commit(), urlRef.current?.commit()];
    if (!ok.every(Boolean)) throw new AsyncActionAbortError();
    try {
      const saved = await orgApi<{ slug: string; auth: McpServer["auth"] }>(
        organizationId,
        `/mcp-servers/${encodeURIComponent(name.trim())}`,
        { method: "PUT", body: JSON.stringify({ url: url.trim() }) },
      );
      onSaved(saved);
      window.setTimeout(() => onOpenChange(false), 400);
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not save the server."));
      throw cause;
    }
  }

  return (
    <SettingsDialogShell
      description={
        server
          ? "A new URL drops the organization's sign-in, so the server needs connecting again."
          : "Preprocess checks the server when you save: whether it asks for a sign-in, and which transport it speaks."
      }
      onOpenChange={onOpenChange}
      open={open}
      title={server ? `Change ${server.slug} URL` : "Add MCP server"}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        {server ? null : (
          <ValidatedField
            autoFocus
            hint="The name your agents' code uses for it."
            id="mcp-name"
            label="Name"
            onChange={setName}
            placeholder="inventory"
            ref={nameRef}
            validate={(value) =>
              validateName(value) ??
              (names.includes(value.trim())
                ? "A server already has this name."
                : null)
            }
            value={name}
          />
        )}
        <ValidatedField
          autoFocus={server !== null}
          hint="A remote server over https."
          id="mcp-url"
          label="URL"
          onChange={setUrl}
          placeholder="https://mcp.example.com"
          ref={urlRef}
          type="url"
          validate={validateUrl}
          value={url}
        />
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
            pendingLabel="Checking…"
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

/** Which agents' code may use a server: grants and revokes the difference. */
function AgentsDialog({
  open,
  onOpenChange,
  organizationId,
  server,
  onSaved,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  server: McpServer;
  onSaved: () => void;
}>) {
  const agents = useQuery({
    queryKey: ["agents", organizationId],
    queryFn: () => orgApi<Agent[]>(organizationId, "/agents"),
  });
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [granted, setGranted] = useState<readonly string[]>(server.agents);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = (agents.data ?? []).filter(
    (agent) => !agent.archived || server.agents.includes(agent.slug),
  );

  async function save() {
    setError(null);
    const changes = [
      ...granted
        .filter((slug) => !server.agents.includes(slug))
        .map((slug) => ({ slug, method: "PUT" })),
      ...server.agents
        .filter((slug) => !granted.includes(slug))
        .map((slug) => ({ slug, method: "DELETE" })),
    ];
    try {
      for (const change of changes)
        await orgApi(
          organizationId,
          `/mcp-servers/${encodeURIComponent(server.slug)}/agents/${encodeURIComponent(change.slug)}`,
          { method: change.method },
        );
      window.setTimeout(() => onOpenChange(false), 400);
    } catch (cause) {
      setError(actionErrorMessage(cause, "Could not save the agents."));
      throw cause;
    } finally {
      if (changes.length > 0) onSaved();
    }
  }

  return (
    <SettingsDialogShell
      description="Agents whose code may call this server. Code that names a server it isn't granted waits at deploy until it is."
      onOpenChange={onOpenChange}
      open={open}
      title={`Agents using ${server.slug}`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        {agents.isError ? (
          <SettingsError error={agents.error} inline />
        ) : agents.data === undefined ? (
          <SettingsSkeletonRows count={2} />
        ) : choices.length === 0 ? (
          <SettingsPanelMessage>
            No agents yet. Deploy one, then grant it this server.
          </SettingsPanelMessage>
        ) : (
          <ScrollArea className="max-h-64" viewportClassName="scroll-fade">
            <CheckboxGroup
              checkedIndices={
                new Set(
                  choices.flatMap((agent, index) =>
                    granted.includes(agent.slug) ? [index] : [],
                  ),
                )
              }
            >
              {choices.map((agent, index) => (
                <CheckboxItem
                  checked={granted.includes(agent.slug)}
                  index={index}
                  key={agent.slug}
                  label={agent.slug}
                  onToggle={() =>
                    setGranted((current) =>
                      current.includes(agent.slug)
                        ? current.filter((slug) => slug !== agent.slug)
                        : [...current, agent.slug],
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
            disabled={agents.data === undefined}
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

/** The tools a server offers, read live through the organization's connection. */
function ToolsDialog({
  open,
  onOpenChange,
  organizationId,
  server,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  server: McpServer;
}>) {
  const tools = useQuery({
    queryKey: ["mcp-server-tools", organizationId, server.slug],
    retry: false,
    queryFn: () =>
      orgApi<McpTool[]>(
        organizationId,
        `/mcp-servers/${encodeURIComponent(server.slug)}/tools`,
      ),
  });

  return (
    <SettingsDialogShell
      description="What the server offers right now. Granted agents can call every one."
      footer={
        <Button
          onClick={() => onOpenChange(false)}
          type="button"
          variant="secondary"
        >
          Close
        </Button>
      }
      onOpenChange={onOpenChange}
      open={open}
      size="lg"
      title={`${server.slug} tools`}
    >
      {tools.isError ? (
        <SettingsPanelMessage tone="danger">
          {actionErrorMessage(tools.error, "Could not reach the server.")}
        </SettingsPanelMessage>
      ) : tools.data === undefined ? (
        <SettingsSkeletonRows count={3} />
      ) : tools.data.length === 0 ? (
        <SettingsPanelMessage>The server offers no tools.</SettingsPanelMessage>
      ) : (
        <ScrollArea className="max-h-80" viewportClassName="scroll-fade">
          <DialogRows>
            {tools.data.map((tool) => (
              <SettingsRow
                description={tool.description}
                key={tool.name}
                label={<ServerName name={tool.name} />}
              />
            ))}
          </DialogRows>
        </ScrollArea>
      )}
    </SettingsDialogShell>
  );
}
