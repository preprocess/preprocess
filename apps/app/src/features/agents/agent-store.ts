import {
  mcpServerFrom,
  platformSecretKeys,
  DEFAULT_SECRET_SCOPE,
  type SecretScope,
  type McpServer,
  type McpServerInput,
  type NetworkRule,
} from "../developers/platform-store";
import {
  AGENT_SEED,
  type AgentAccessLevel,
  type AgentGrant,
  type AgentSeed,
} from "./agent-seed";

/**
 * In-memory agents: deployments, environment variables, and access grants
 * over the seed. Changes (a rollback, a new variable, a grant) stick until
 * the dev server restarts. There is no agents backend yet; builds outside
 * dev serve none.
 */

export type DeploymentStatus = "ready" | "failed";

/** Claude models an agent can run on. */
export const AGENT_MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
] as const;
export type AgentModel = (typeof AGENT_MODELS)[number]["id"];

export const REASONING_LEVELS = ["low", "medium", "high"] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export function modelLabel(model: AgentModel): string {
  return AGENT_MODELS.find((item) => item.id === model)?.label ?? model;
}

/**
 * A deployment pins the code and the model it runs: rolling back restores
 * both, and an evaluation score belongs to one exact model and reasoning level.
 */
export type AgentDeployment = {
  readonly id: string;
  readonly status: DeploymentStatus;
  /** The branch it built from, which also picks its environment. */
  readonly branch: string;
  readonly model: AgentModel;
  readonly reasoning: ReasoningLevel;
  readonly message: string;
  readonly author: string;
  readonly createdAt: string;
  readonly durationSeconds: number;
};

export type DeploymentEnvironment = "production" | "preview";

export const DEFAULT_PRODUCTION_BRANCH = "main";

/** Every branch deploys: the production branch builds for production, the rest preview. */
export function deploymentEnvironment(
  branch: string,
  productionBranch: string = DEFAULT_PRODUCTION_BRANCH,
): DeploymentEnvironment {
  return branch === productionBranch ? "production" : "preview";
}

/** Branches by age, newest first, so the list mixes production and previews. */
const BRANCHES = [
  "main",
  "feat/exhibit-check",
  "main",
  "main",
  "fix/retry-timeouts",
  "main",
  "feat/renewal-threshold",
  "main",
];

export type AgentEnvVar = {
  readonly key: string;
  readonly value: string;
  readonly scope: SecretScope;
  readonly updatedAt: string;
};

export type StoredAgent = Omit<AgentSeed, "deploys" | "deployedAt"> & {
  /** Newest first. */
  readonly deployments: readonly AgentDeployment[];
  /** The deployment serving production; a rollback moves it. */
  readonly productionId: string;
  readonly env: readonly AgentEnvVar[];
  /** The sandbox image the agent runs in; null uses the organization's default. */
  readonly sandboxImageId: string | null;
  /**
   * The agent's own network rules. They sit on top of the organization's;
   * a rule for a pattern the organization also rules on overrides it.
   */
  readonly network: readonly NetworkRule[];
  /**
   * Everyone in the organization gets at least this level; null leaves
   * access to the group grants alone. A group's grant can only raise it.
   */
  readonly everyone: AgentAccessLevel | null;
  /** Where the agent's code lives; deployments build from it. */
  readonly repo: AgentRepo | null;
  /** Organization MCP servers this agent has turned on; the rest are off. */
  readonly mcp: readonly AgentMcpGrant[];
  /** MCP servers only this agent uses. */
  readonly mcpServers: readonly McpServer[];
};

/** An organization MCP server turned on for one agent. */
export type AgentMcpGrant = {
  readonly serverId: string;
  /** The tools it may call; null allows every tool, including new ones. */
  readonly tools: readonly string[] | null;
};

/**
 * Where the agent's code lives. Every branch deploys, the way Vercel does
 * it: the production branch builds for production and any other branch
 * gets a preview. Promoting a build is what puts it live.
 */
export type AgentRepo = {
  /** A connected repository's id (Developers → Integrations). */
  readonly repoId: string;
  /** The agent's folder, relative to the repository root. */
  readonly path: string;
  /** The branch whose builds are production; `main` unless changed. */
  readonly productionBranch: string;
};

/** Thrown when an agent variable would shadow an organization secret. */
export class EnvOverrideError extends Error {
  constructor(key: string) {
    super(`${key} is set by the organization and can't be overridden here.`);
    this.name = "EnvOverrideError";
  }
}

const MESSAGES = [
  "Tighten counterparty extraction on scanned PDFs",
  "Ask for missing exhibits before review",
  "Cache parsed workbooks between runs",
  "Retry tool calls that time out",
  "Route redlines to Legal when terms change",
  "Summarize long email threads first",
  "Raise the review threshold for renewals",
  "Initial deploy",
] as const;

const AUTHORS = ["Ada Park", "Theo Grant", "Mina Okafor", "Jules Moreau"];

const DEPLOYMENT_COUNT = 8;

const ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** A stable, random-looking deployment id, so seeds match across reloads. */
function seedDeploymentId(agentId: string, build: number) {
  let hash = 2166136261;
  let id = "dpl_";
  for (let index = 0; index < 9; index++) {
    for (const char of `${agentId}:${build}:${index}`) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    }
    id += ID_ALPHABET[(hash >>> 0) % ID_ALPHABET.length];
  }
  return id;
}

/** A deployment id as it is shown: the first seven characters after the prefix. */
export function shortDeploymentId(id: string) {
  return id.replace(/^dpl_/, "").slice(0, 7);
}

function seedDeployments(seed: AgentSeed): AgentDeployment[] {
  const deployedAt = Date.parse(seed.deployedAt);
  return Array.from({ length: DEPLOYMENT_COUNT }, (_, index) => {
    // Which deploy this was, counting from the agent's first.
    const build = seed.deploys - index;
    // One older build failed, so the list shows what a failure looks like.
    const failed = index === 2;
    return {
      id: seedDeploymentId(seed.id, build),
      status: failed ? "failed" : "ready",
      branch: BRANCHES[index % BRANCHES.length] ?? "main",
      message:
        index === DEPLOYMENT_COUNT - 1 && build <= 1
          ? "Initial deploy"
          : (MESSAGES[(build + seed.id.length) % (MESSAGES.length - 1)] ??
            "Update"),
      author: AUTHORS[(build + index) % AUTHORS.length] ?? "Ada Park",
      createdAt: new Date(
        deployedAt - index * (2 * 86_400_000 + index * 3_600_000),
      ).toISOString(),
      durationSeconds: failed ? 23 : 40 + ((build * 7) % 50),
      // The four newest deployments moved from Haiku to Sonnet; the two newest
      // stepped reasoning up, so the list shows what a config change looks like.
      model: index < 4 ? "claude-sonnet-5-5" : "claude-haiku-5-5",
      reasoning: index < 2 ? "high" : "medium",
    };
  });
}

function seedEnv(seed: AgentSeed): AgentEnvVar[] {
  const updatedAt = seed.deployedAt;
  return [
    { key: "MODEL", value: "claude-sonnet-5-5", scope: "all", updatedAt },
    { key: "MAX_STEPS", value: "40", scope: "all", updatedAt },
    {
      key: "REVIEW_WEBHOOK_URL",
      value: `https://hooks.example.com/${seed.id}`,
      scope: "production",
      updatedAt,
    },
    {
      key: "VENDOR_API_KEY",
      value: `sk_live_${seed.id}_8f3a2b1c9e04`,
      scope: "production",
      updatedAt,
    },
  ];
}

/** Agents open to the whole organization at a baseline level. */
const SEED_EVERYONE: Readonly<Record<string, AgentAccessLevel>> = {
  support: "viewer",
};

/** Agents that run on a non-default image. */
const SEED_IMAGES: Readonly<Record<string, string>> = {
  sales: "img_office",
  lab: "img_python",
};

/** Agent rules: plain additions, and a few that override the organization. */
const SEED_NETWORK: Readonly<Record<string, readonly NetworkRule[]>> = {
  sales: [{ pattern: "api.stripe.com", kind: "allow" }],
  lab: [
    // The organization blocks ngrok; the lab agent needs it for test hooks.
    { pattern: "*.ngrok.io", kind: "allow" },
    { pattern: "api.openai.com", kind: "allow" },
  ],
  legal: [
    // The organization allows GitHub; legal work has no reason to reach it.
    { pattern: "*.github.com", kind: "block" },
  ],
};

const SEED_MCP: Readonly<Record<string, readonly AgentMcpGrant[]>> = {
  intake: [{ serverId: "mcp_documents", tools: null }],
  review: [
    { serverId: "mcp_documents", tools: null },
    { serverId: "mcp_tickets", tools: ["list_tickets", "add_comment"] },
  ],
  sales: [{ serverId: "mcp_inventory", tools: ["lookup_part", "check_stock"] }],
  support: [{ serverId: "mcp_tickets", tools: null }],
};

const SEED_AGENT_MCP: Readonly<Record<string, readonly McpServer[]>> = {
  lab: [
    {
      id: "mcp_lab_fixtures",
      name: "Lab fixtures",
      url: "https://lab.acme.com/mcp",
      auth: "none",
      token: null,
      tools: [
        { name: "load_fixture", description: "Load a saved test case." },
        { name: "record_run", description: "Save a run for comparison." },
      ],
      addedAt: "2026-09-20T11:00:00.000Z",
    },
  ],
};

let agents: Map<string, StoredAgent> | undefined;

function store(): Map<string, StoredAgent> {
  agents ??= new Map(
    (import.meta.env.DEV ? AGENT_SEED : []).map((seed) => {
      const deployments = seedDeployments(seed);
      // The seed's deploy count and date become its newest deployment.
      return [
        seed.id,
        {
          id: seed.id,
          name: seed.name,
          description: seed.description,
          access: seed.access,
          everyone: SEED_EVERYONE[seed.id] ?? null,
          // Lab lives in its own repo; the rest share one, a folder each.
          repo:
            seed.id === "lab"
              ? {
                  repoId: "repo_lab",
                  path: "lab",
                  productionBranch: DEFAULT_PRODUCTION_BRANCH,
                }
              : seed.id === "support"
                ? null
                : {
                    repoId: "repo_agents",
                    path: `agents/${seed.id}`,
                    productionBranch: DEFAULT_PRODUCTION_BRANCH,
                  },
          deployments,
          // Production serves the newest ready build of main.
          productionId:
            deployments.find(
              (item) =>
                item.status === "ready" &&
                deploymentEnvironment(item.branch) === "production",
            )?.id ?? "",
          env: seedEnv(seed),
          sandboxImageId: SEED_IMAGES[seed.id] ?? null,
          network: SEED_NETWORK[seed.id] ?? [],
          mcp: SEED_MCP[seed.id] ?? [],
          mcpServers: SEED_AGENT_MCP[seed.id] ?? [],
        },
      ];
    }),
  );
  return agents;
}

function update(id: string, change: (agent: StoredAgent) => StoredAgent) {
  const agent = store().get(id);
  if (!agent) throw new Error(`No agent ${id}.`);
  const next = change(agent);
  store().set(id, next);
  return next;
}

export function storedAgents(): readonly StoredAgent[] {
  return [...store().values()];
}

export function storedAgent(id: string): StoredAgent | undefined {
  return store().get(id);
}

export function productionDeployment(
  agent: StoredAgent,
): AgentDeployment | undefined {
  return agent.deployments.find((item) => item.id === agent.productionId);
}

/** Serves an earlier ready deployment in production again. */
export function promoteDeployment(
  agentId: string,
  deploymentId: string,
): Promise<StoredAgent> {
  return Promise.resolve(
    update(agentId, (agent) => {
      const target = agent.deployments.find((item) => item.id === deploymentId);
      if (!target || target.status !== "ready") {
        throw new Error("Only a ready deployment can serve production.");
      }
      return { ...agent, productionId: target.id };
    }),
  );
}

/**
 * Adds a variable or replaces the one with the same key. Keys the
 * organization sets as secrets are refused: agents never override them.
 */
export function setAgentEnvVar(
  agentId: string,
  key: string,
  value: string,
  scope: SecretScope = DEFAULT_SECRET_SCOPE,
): Promise<StoredAgent> {
  if (platformSecretKeys().has(key)) {
    return Promise.reject(new EnvOverrideError(key));
  }
  return Promise.resolve(
    update(agentId, (agent) => {
      const next = { key, value, scope, updatedAt: new Date().toISOString() };
      const exists = agent.env.some((item) => item.key === key);
      return {
        ...agent,
        env: exists
          ? agent.env.map((item) => (item.key === key ? next : item))
          : [...agent.env, next],
      };
    }),
  );
}

export function deleteAgentEnvVar(
  agentId: string,
  key: string,
): Promise<StoredAgent> {
  return Promise.resolve(
    update(agentId, (agent) => ({
      ...agent,
      env: agent.env.filter((item) => item.key !== key),
    })),
  );
}

/** Grants a group a level on the agent, or removes its grant with null. */
export function setAgentAccess(
  agentId: string,
  group: string,
  level: AgentAccessLevel | null,
): Promise<StoredAgent> {
  return Promise.resolve(
    update(agentId, (agent) => {
      const others = agent.access.filter((grant) => grant.group !== group);
      const access: AgentGrant[] = level
        ? [...others, { group, level }]
        : [...others];
      // Operators first, then viewers, each by name.
      access.sort((left, right) =>
        left.level === right.level
          ? left.group.localeCompare(right.group)
          : left.level === "operator"
            ? -1
            : 1,
      );
      return { ...agent, access };
    }),
  );
}

/** Sets everyone's baseline access to the agent; null removes it. */
export function setAgentEveryoneAccess(
  agentId: string,
  level: AgentAccessLevel | null,
): Promise<StoredAgent> {
  return Promise.resolve(
    update(agentId, (agent) => ({ ...agent, everyone: level })),
  );
}

export function updateAgentDetails(
  agentId: string,
  details: { name: string; description: string },
): Promise<StoredAgent> {
  return Promise.resolve(
    update(agentId, (agent) => ({ ...agent, ...details })),
  );
}

/** Keys each agent sets, so the organization can't add a clashing secret. */
export function agentEnvKeys(): ReadonlyMap<string, readonly string[]> {
  const keys = new Map<string, string[]>();
  for (const agent of store().values()) {
    for (const item of agent.env) {
      keys.set(item.key, [...(keys.get(item.key) ?? []), agent.name]);
    }
  }
  return keys;
}

export function setAgentSandboxImage(
  agentId: string,
  imageId: string | null,
): Promise<StoredAgent> {
  return Promise.resolve(
    update(agentId, (agent) => ({ ...agent, sandboxImageId: imageId })),
  );
}

/** Adds an agent rule, replacing the agent's rule for the same pattern. */
export function setAgentNetworkRule(
  agentId: string,
  rule: NetworkRule,
): Promise<StoredAgent> {
  return Promise.resolve(
    update(agentId, (agent) => ({
      ...agent,
      network: [
        ...agent.network.filter((item) => item.pattern !== rule.pattern),
        rule,
      ],
    })),
  );
}

export function deleteAgentNetworkRule(
  agentId: string,
  pattern: string,
): Promise<StoredAgent> {
  return Promise.resolve(
    update(agentId, (agent) => ({
      ...agent,
      network: agent.network.filter((item) => item.pattern !== pattern),
    })),
  );
}

/** Agents using each image, by id; null counts agents on the default. */
export function sandboxImageUsage(): ReadonlyMap<string | null, number> {
  const usage = new Map<string | null, number>();
  for (const agent of store().values()) {
    usage.set(agent.sandboxImageId, (usage.get(agent.sandboxImageId) ?? 0) + 1);
  }
  return usage;
}

/** Moves agents off a removed image, back to the organization default. */
export function clearSandboxImage(imageId: string): Promise<void> {
  for (const agent of store().values()) {
    if (agent.sandboxImageId === imageId) {
      store().set(agent.id, { ...agent, sandboxImageId: null });
    }
  }
  return Promise.resolve();
}

/** What other pages show of an agent: its name. */
export type AgentSummary = {
  readonly id: string;
  readonly name: string;
};

export function agentSummaries(): Readonly<Record<string, AgentSummary>> {
  return Object.fromEntries(
    [...store().values()].map((agent) => [
      agent.id,
      { id: agent.id, name: agent.name },
    ]),
  );
}

/** Points the agent at a repository folder, or disconnects it with null. */
export function setAgentRepo(
  agentId: string,
  repo: AgentRepo | null,
): Promise<StoredAgent> {
  return Promise.resolve(update(agentId, (agent) => ({ ...agent, repo })));
}

/** Turns an organization MCP server on (every tool) or off for the agent. */
export function setAgentMcpEnabled(
  agentId: string,
  serverId: string,
  enabled: boolean,
): Promise<StoredAgent> {
  return Promise.resolve(
    update(agentId, (agent) => ({
      ...agent,
      mcp: enabled
        ? [
            ...agent.mcp.filter((grant) => grant.serverId !== serverId),
            { serverId, tools: null },
          ]
        : agent.mcp.filter((grant) => grant.serverId !== serverId),
    })),
  );
}

/** Narrows a turned-on server to some tools, or allows all with null. */
export function setAgentMcpTools(
  agentId: string,
  serverId: string,
  tools: readonly string[] | null,
): Promise<StoredAgent> {
  return Promise.resolve(
    update(agentId, (agent) => ({
      ...agent,
      mcp: agent.mcp.map((grant) =>
        grant.serverId === serverId ? { serverId, tools } : grant,
      ),
    })),
  );
}

/** Adds one of the agent's own servers, or updates the one with `id`. */
export function saveAgentMcpServer(
  agentId: string,
  input: McpServerInput,
  id?: string,
): Promise<StoredAgent> {
  return Promise.resolve(
    update(agentId, (agent) => {
      const previous = agent.mcpServers.find((server) => server.id === id);
      const next = mcpServerFrom(input, previous);
      return {
        ...agent,
        mcpServers: previous
          ? agent.mcpServers.map((server) => (server.id === id ? next : server))
          : [...agent.mcpServers, next],
      };
    }),
  );
}

export function deleteAgentMcpServer(
  agentId: string,
  id: string,
): Promise<StoredAgent> {
  return Promise.resolve(
    update(agentId, (agent) => ({
      ...agent,
      mcpServers: agent.mcpServers.filter((server) => server.id !== id),
    })),
  );
}

/** Agents that turned on each organization server, by server id. */
export function mcpServerUsage(): ReadonlyMap<string, number> {
  const usage = new Map<string, number>();
  for (const agent of store().values()) {
    for (const grant of agent.mcp) {
      usage.set(grant.serverId, (usage.get(grant.serverId) ?? 0) + 1);
    }
  }
  return usage;
}

/** Turns a removed organization server off for every agent. */
export function clearMcpServer(serverId: string): Promise<void> {
  for (const agent of store().values()) {
    store().set(agent.id, {
      ...agent,
      mcp: agent.mcp.filter((grant) => grant.serverId !== serverId),
    });
  }
  return Promise.resolve();
}
