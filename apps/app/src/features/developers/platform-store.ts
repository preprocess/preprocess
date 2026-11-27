/**
 * In-memory organization platform settings: secrets,
 * network rules every agent inherits, and MCP servers agents opt into. Changes stick until the dev server
 * restarts. There is no backend yet; builds outside dev serve none.
 */

/**
 * Which deployments get a secret. New secrets default to production only,
 * so previews and dev sessions run on test credentials unless someone opts
 * them in.
 */
export type SecretScope = "production" | "preview" | "all";

export const DEFAULT_SECRET_SCOPE: SecretScope = "production";

export type OrgSecret = {
  readonly key: string;
  readonly value: string;
  readonly scope: SecretScope;
  readonly updatedAt: string;
};

/**
 * A secret as the browser sees it. Values are write-only once saved, like
 * GitHub's and Vercel's sensitive variables: nothing of the value comes
 * back, only its name and when it last changed.
 */
export type SecretSummary = {
  readonly key: string;
  readonly scope: SecretScope;
  readonly updatedAt: string;
};

export function summarizeSecret(secret: {
  key: string;
  scope: SecretScope;
  updatedAt: string;
}): SecretSummary {
  return { key: secret.key, scope: secret.scope, updatedAt: secret.updatedAt };
}

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
  secrets: OrgSecret[];
  network: NetworkRule[];
  repos: RepoConnection[];
  mcpServers: McpServer[];
};

const SEEDED_AT = "2026-08-10T12:00:00.000Z";

function seed(): PlatformState {
  if (!import.meta.env.DEV) {
    return {
      secrets: [],
      network: [],
      repos: [],
      mcpServers: [],
    };
  }
  return {
    secrets: [
      {
        key: "ANTHROPIC_API_KEY",
        value: "sk-ant-7f3a2b1c9e04",
        scope: "all",
        updatedAt: SEEDED_AT,
      },
      {
        key: "SENTRY_DSN",
        value: "https://8c1f@o42.ingest.sentry.io/77",
        scope: "all",
        updatedAt: SEEDED_AT,
      },
      {
        key: "STORAGE_BUCKET",
        value: "preprocess-org-artifacts",
        scope: "production",
        updatedAt: SEEDED_AT,
      },
    ],
    network: [
      { pattern: "api.anthropic.com", kind: "allow" },
      { pattern: "*.github.com", kind: "allow" },
      { pattern: "*.googleapis.com", kind: "allow" },
      { pattern: "pastebin.com", kind: "block" },
      { pattern: "*.ngrok.io", kind: "block" },
    ],
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
  readonly secrets: readonly SecretSummary[];
  readonly network: readonly NetworkRule[];
  readonly repos: readonly RepoConnection[];
  readonly mcpServers: readonly McpServerSummary[];
};

export function getPlatformSettings(): Promise<PlatformSettings> {
  const { secrets, network, repos, mcpServers } = platform();
  return Promise.resolve({
    secrets: secrets.map(summarizeSecret),
    network: [...network],
    repos: [...repos],
    mcpServers: mcpServers.map(summarizeMcpServer),
  });
}

/** Keys the organization sets; agents may not set them too. */
export function platformSecretKeys(): ReadonlySet<string> {
  return new Set(platform().secrets.map((item) => item.key));
}

export function setOrgSecret(
  key: string,
  value: string,
  scope: SecretScope = DEFAULT_SECRET_SCOPE,
): Promise<void> {
  const current = platform();
  const next = { key, value, scope, updatedAt: new Date().toISOString() };
  current.secrets = current.secrets.some((item) => item.key === key)
    ? current.secrets.map((item) => (item.key === key ? next : item))
    : [...current.secrets, next];
  return Promise.resolve();
}

export function deleteOrgSecret(key: string): Promise<void> {
  const current = platform();
  current.secrets = current.secrets.filter((item) => item.key !== key);
  return Promise.resolve();
}

/** Adds a rule, replacing any rule for the same pattern. */
export function setOrgNetworkRule(rule: NetworkRule): Promise<void> {
  const current = platform();
  current.network = [
    ...current.network.filter((item) => item.pattern !== rule.pattern),
    rule,
  ];
  return Promise.resolve();
}

export function deleteOrgNetworkRule(pattern: string): Promise<void> {
  const current = platform();
  current.network = current.network.filter((item) => item.pattern !== pattern);
  return Promise.resolve();
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
