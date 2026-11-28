import { createFileRoute } from "@tanstack/react-router";

import { ModelsPanel } from "../../../features/models/models-panel";

export const Route = createFileRoute("/settings/organization/models")({
  component: ModelsPanel,
});
