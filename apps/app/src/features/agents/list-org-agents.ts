import { createServerFn } from "@tanstack/react-start";

/**
 * The organization's agents from the API. An agent is addressed by its slug,
 * which doubles as its name until agents carry one. Reads run as server
 * functions for the route loaders.
 */

export type OrgAgent = {
  /** The agent's slug, as the API and the URL name it. */
  readonly id: string;
  readonly name: string;
  readonly productionBranch: string;
  readonly productionDeploymentId: string | null;
};

export type AgentDeploymentSummary = {
  readonly id: string;
  readonly status: "ready" | "waiting" | "failed" | "building";
  readonly model: string;
  readonly reasoning: string;
  readonly branch: string | null;
  readonly commit: string | null;
  readonly source: "cli" | "github";
  readonly createdAt: string;
};

/** One agent with what its page header and overview show. */
export type OrgAgentDetail = OrgAgent & {
  readonly production: AgentDeploymentSummary | null;
};

type ApiAgent = {
  id: string;
  slug: string;
  productionBranch: string;
  productionDeploymentId: string | null;
  archived: boolean;
};

type ApiDeployment = AgentDeploymentSummary & {
  git: { branch: string | null; commit: string | null };
};

const toOrgAgent = (agent: ApiAgent): OrgAgent => ({
  id: agent.slug,
  name: agent.slug,
  productionBranch: agent.productionBranch,
  productionDeploymentId: agent.productionDeploymentId,
});

/** The organization's agents that aren't archived, by name. */
export async function orgAgents(): Promise<OrgAgent[]> {
  const { activeOrgJson } = await import("../../server/api.server");
  const agents = await activeOrgJson<ApiAgent[]>("/agents");
  return agents.filter((agent) => !agent.archived).map(toOrgAgent);
}

export const listOrgAgents = createServerFn({ method: "GET" }).handler(() =>
  orgAgents(),
);

/** One agent by slug with its production deployment, or null. */
export async function orgAgent(slug: string): Promise<OrgAgentDetail | null> {
  const { activeOrgJson } = await import("../../server/api.server");
  const path = `/agents/${encodeURIComponent(slug)}`;
  const agent = await activeOrgJson<ApiAgent | null>(path, {
    notFound: null,
  });
  if (!agent) return null;
  const deployment = agent.productionDeploymentId
    ? await activeOrgJson<ApiDeployment | null>(
        `${path}/deployments/${encodeURIComponent(agent.productionDeploymentId)}`,
        { notFound: null },
      )
    : null;
  return {
    ...toOrgAgent(agent),
    production: deployment && {
      id: deployment.id,
      status: deployment.status,
      model: deployment.model,
      reasoning: deployment.reasoning,
      branch: deployment.git.branch,
      commit: deployment.git.commit,
      source: deployment.source,
      createdAt: deployment.createdAt,
    },
  };
}

export const getOrgAgent = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(({ data: slug }) => orgAgent(slug));
