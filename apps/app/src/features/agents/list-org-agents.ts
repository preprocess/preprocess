import {
  getOrgCaseStatsByAgent,
  type AgentCaseStats,
} from "../agent-cases/list-org-cases";
import {
  summarizeMcpServer,
  summarizeSecret,
  type McpServerSummary,
  type NetworkRule,
  type SecretSummary,
} from "../developers/platform-store";
import { listAgentMemories, type AgentMemory } from "./agent-memories";
import type { AgentAccessLevel, AgentGrant } from "./agent-seed";
import {
  productionDeployment,
  storedAgent,
  storedAgents,
  type AgentDeployment,
  type AgentMcpGrant,
  type AgentRepo,
  type StoredAgent,
} from "./agent-store";

export type OrgAgent = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** The production deployment's id and when it was deployed. */
  readonly deploymentId: string;
  readonly deployedAt: string;
  readonly access: readonly AgentGrant[];
  /** Everyone's baseline level, or null for groups only. */
  readonly everyone: AgentAccessLevel | null;
  readonly stats: AgentCaseStats;
};

/** One agent with everything its management page shows. */
export type OrgAgentDetail = OrgAgent & {
  readonly deployments: readonly AgentDeployment[];
  readonly productionId: string;
  readonly env: readonly SecretSummary[];
  readonly sandboxImageId: string | null;
  readonly repo: AgentRepo | null;
  readonly network: readonly NetworkRule[];
  readonly mcp: readonly AgentMcpGrant[];
  readonly mcpServers: readonly McpServerSummary[];
  /** Newest first. */
  readonly memories: readonly AgentMemory[];
};

const NO_CASES: AgentCaseStats = {
  byStatus: { Waiting: 0, Active: 0, Done: 0 },
  total: 0,
  costCents: 0,
  lastUpdatedAt: null,
};

function toOrgAgent(agent: StoredAgent, stats: AgentCaseStats): OrgAgent {
  const production = productionDeployment(agent);
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    deploymentId: production?.id ?? "",
    deployedAt: production?.createdAt ?? "",
    access: agent.access,
    everyone: agent.everyone,
    stats,
  };
}

/**
 * The organization's agents with their case stats, most recently busy
 * first. Seeded in development; builds outside dev serve none.
 */
export async function listOrgAgents(): Promise<readonly OrgAgent[]> {
  const stats = await getOrgCaseStatsByAgent();
  return storedAgents()
    .map((agent) => toOrgAgent(agent, stats.get(agent.id) ?? NO_CASES))
    .sort(
      (left, right) =>
        Date.parse(right.stats.lastUpdatedAt ?? "0") -
        Date.parse(left.stats.lastUpdatedAt ?? "0"),
    );
}

export async function getOrgAgent(id: string): Promise<OrgAgentDetail | null> {
  const agent = storedAgent(id);
  if (!agent) return null;
  const stats = await getOrgCaseStatsByAgent();
  return {
    ...toOrgAgent(agent, stats.get(id) ?? NO_CASES),
    deployments: agent.deployments,
    productionId: agent.productionId,
    env: agent.env.map(summarizeSecret),
    sandboxImageId: agent.sandboxImageId,
    repo: agent.repo,
    network: agent.network,
    mcp: agent.mcp,
    mcpServers: agent.mcpServers.map(summarizeMcpServer),
    memories: listAgentMemories(id),
  };
}
