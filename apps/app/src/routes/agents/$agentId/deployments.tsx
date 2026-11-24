import {
  createFileRoute,
  getRouteApi,
  useRouter,
} from "@tanstack/react-router";

import {
  AgentDeployments,
  AgentPage,
} from "../../../features/agents/agent-page";
import { promoteDeployment } from "../../../features/agents/agent-store";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/deployments")({
  component: AgentDeploymentsPage,
});

function AgentDeploymentsPage() {
  const agent = agentRoute.useLoaderData();
  const router = useRouter();
  return (
    <AgentPage agent={agent} tab="deployments">
      <AgentDeployments
        agent={agent}
        onPromote={async (deploymentId) => {
          await promoteDeployment(agent.id, deploymentId);
          await router.invalidate();
        }}
      />
    </AgentPage>
  );
}
