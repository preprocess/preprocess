import { Outlet, createFileRoute, notFound } from "@tanstack/react-router";

import { AgentNotFound } from "../../components/route-states";
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
