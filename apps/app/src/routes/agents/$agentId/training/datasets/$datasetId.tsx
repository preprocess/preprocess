import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { AgentPage } from "../../../../../features/agents/agent-page";
import { DatasetPage } from "../../../../../features/training/dataset-page";
import { useDataset } from "../../../../../features/training/training-api";

const agentRoute = getRouteApi("/agents/$agentId");

export const Route = createFileRoute(
  "/agents/$agentId/training/datasets/$datasetId",
)({
  component: AgentDatasetPage,
});

function AgentDatasetPage() {
  const agent = agentRoute.useLoaderData();
  const { datasetId } = Route.useParams();
  const dataset = useDataset(agent.id, datasetId);
  return (
    <AgentPage
      agent={agent}
      detail={dataset.data?.name ?? "Dataset"}
      tab="training"
    >
      <DatasetPage agentSlug={agent.id} datasetId={datasetId} />
    </AgentPage>
  );
}
