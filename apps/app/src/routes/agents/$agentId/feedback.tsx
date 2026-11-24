import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentFeedback } from "../../../features/agents/agent-knowledge";
import { AgentPage } from "../../../features/agents/agent-page";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute("/agents/$agentId/feedback")({
  component: AgentFeedbackPage,
});

function AgentFeedbackPage() {
  return (
    <AgentPage agent={agentRoute.useLoaderData()} tab="feedback">
      <AgentFeedback />
    </AgentPage>
  );
}
