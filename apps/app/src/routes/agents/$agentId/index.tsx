import {
  createFileRoute,
  getRouteApi,
  useRouter,
} from "@tanstack/react-router";

import { AgentOverview, AgentPage } from "../../../features/agents/agent-page";
import { updateAgentDetails } from "../../../features/agents/agent-store";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/")({
  component: AgentOverviewPage,
});

function AgentOverviewPage() {
  const agent = agentRoute.useLoaderData();
  const router = useRouter();
  return (
    <AgentPage agent={agent} tab="">
      <AgentOverview
        agent={agent}
        onSaveDetails={async (details) => {
          await updateAgentDetails(agent.id, details);
          await router.invalidate();
        }}
      />
    </AgentPage>
  );
}
