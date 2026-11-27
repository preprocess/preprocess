/**
 * In-memory organization platform settings: MCP servers agents opt into. Changes stick until the dev server
 * restarts. There is no backend yet; builds outside dev serve none.
 */

/**
 * Which deployments get a secret. New secrets default to production only,
 * so previews and dev sessions run on test credentials unless someone opts
 * them in.
 */
export type SecretScope = "production" | "preview" | "all";

export type NetworkRuleKind = "allow" | "block";

export type NetworkRule = {
  /** A host or URL pattern: `api.github.com`, `*.example.com`. */
  readonly pattern: string;
  readonly kind: NetworkRuleKind;
};

/** How a remote MCP server authenticates our calls. */
export type McpAuthKind = "none" | "oauth" | "token";

/**
 * How we reach a server, detected when it's saved: streamable HTTP, or the
 * deprecated HTTP+SSE transport when that's all the server speaks.
 */
export type McpTransport = "streamable_http" | "sse";

export type McpTool = {
  readonly name: string;
  readonly description: string;
};

/**
 * A remote MCP server over https. A bearer token is write-only once saved,
 * like a secret.
 */
export type McpServer = {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly auth: McpAuthKind;
  readonly transport: McpTransport;
  readonly token: string | null;
  /** What the server last reported; empty until it's been reached. */
  readonly tools: readonly McpTool[];
  readonly addedAt: string;
};

/** A server as the browser sees it: everything but the token. */
export type McpServerSummary = Omit<McpServer, "token">;

export function summarizeMcpServer(server: McpServer): McpServerSummary {
  return {
    id: server.id,
    name: server.name,
    url: server.url,
    auth: server.auth,
    transport: server.transport,
    tools: server.tools,
    addedAt: server.addedAt,
  };
}

/** What the add and edit dialogs send. An empty token keeps the saved one. */
export type McpServerInput = {
  readonly name: string;
  readonly url: string;
  readonly auth: McpAuthKind;
  readonly token: string;
};

/** Builds or updates a server from the dialog's input. */
export function mcpServerFrom(
  input: McpServerInput,
  previous?: McpServer,
): McpServer {
  return {
    id: previous?.id ?? `mcp_${Date.now().toString(36)}`,
    name: input.name,
    url: input.url,
    auth: input.auth,
    // Seeded: a real backend detects it when it first reaches the server.
    transport:
      previous?.url === input.url ? previous.transport : "streamable_http",
    token:
      input.auth === "token" ? input.token || (previous?.token ?? null) : null,
    // Seeded: a real backend lists tools when it first reaches the server.
    tools: previous?.url === input.url ? previous.tools : [],
    addedAt: previous?.addedAt ?? new Date().toISOString(),
  };
}

/** A repository the organization connected (Developers → Integrations). */
export type RepoConnection = {
  readonly id: string;
  /** `owner/name`. */
  readonly fullName: string;
};

type PlatformState = {
  repos: RepoConnection[];
  mcpServers: McpServer[];
};

const SEEDED_AT = "2026-08-10T12:00:00.000Z";

function seed(): PlatformState {
  if (!import.meta.env.DEV) {
    return {
      repos: [],
      mcpServers: [],
    };
  }
  return {
    // Seeded: there is no GitHub connection flow yet.
    repos: [
      { id: "repo_agents", fullName: "acme/agents" },
      { id: "repo_lab", fullName: "acme/agent-lab" },
    ],
    mcpServers: [
      {
        id: "mcp_documents",
        name: "Document store",
        url: "https://mcp.acme.com/documents",
        auth: "oauth",
        transport: "streamable_http",
        token: null,
        tools: [
          { name: "search_documents", description: "Full-text search." },
          { name: "read_document", description: "Read one document." },
          { name: "list_folders", description: "Browse the folder tree." },
        ],
        addedAt: SEEDED_AT,
      },
      {
        id: "mcp_inventory",
        name: "Inventory",
        url: "https://mcp.acme.com/inventory",
        auth: "token",
        transport: "streamable_http",
        token: "seeded-demo-token",
        tools: [
          { name: "lookup_part", description: "Find a part by number." },
          { name: "check_stock", description: "Stock on hand by site." },
          { name: "reserve_stock", description: "Hold stock for an order." },
          { name: "list_sites", description: "Warehouses and yards." },
        ],
        addedAt: "2026-08-18T10:15:00.000Z",
      },
      {
        id: "mcp_tickets",
        name: "Ticketing",
        url: "https://tickets.acme.com/mcp",
        auth: "token",
        transport: "sse",
        token: "tkt_4b8e1f07",
        tools: [
          { name: "list_tickets", description: "Open tickets by queue." },
          { name: "create_ticket", description: "Open a ticket." },
          { name: "update_ticket", description: "Change status or owner." },
          { name: "add_comment", description: "Comment on a ticket." },
        ],
        addedAt: "2026-09-02T14:00:00.000Z",
      },
    ],
  };
}

let state: PlatformState | undefined;

function platform(): PlatformState {
  state ??= seed();
  return state;
}

export type PlatformSettings = {
  readonly repos: readonly RepoConnection[];
  readonly mcpServers: readonly McpServerSummary[];
};

export function getPlatformSettings(): Promise<PlatformSettings> {
  const { repos, mcpServers } = platform();
  return Promise.resolve({
    repos: [...repos],
    mcpServers: mcpServers.map(summarizeMcpServer),
  });
}

/** Adds a server, or updates the one with `id`. */
export function saveOrgMcpServer(
  input: McpServerInput,
  id?: string,
): Promise<void> {
  const current = platform();
  const previous = current.mcpServers.find((server) => server.id === id);
  const next = mcpServerFrom(input, previous);
  current.mcpServers = previous
    ? current.mcpServers.map((server) => (server.id === id ? next : server))
    : [...current.mcpServers, next];
  return Promise.resolve();
}

export function deleteOrgMcpServer(id: string): Promise<void> {
  const current = platform();
  current.mcpServers = current.mcpServers.filter((server) => server.id !== id);
  return Promise.resolve();
}
