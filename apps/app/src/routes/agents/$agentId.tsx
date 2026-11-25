import { Outlet, createFileRoute, notFound } from "@tanstack/react-router";

import { getOrgAgent } from "../../features/agents/list-org-agents";

export const Route = createFileRoute("/agents/$agentId")({
  staticData: { ownsHeader: true },
  loader: async ({ params }) => {
    const agent = await getOrgAgent({ data: params.agentId });
    if (!agent) throw notFound();
    return agent;
  },
  component: Outlet,
  notFoundComponent: AgentNotFound,
});

function AgentNotFound() {
  return <p className="p-6 text-body">This agent doesn't exist.</p>;
}
