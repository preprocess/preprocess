import { createFileRoute } from "@tanstack/react-router";

import { DirectorySyncPanel } from "../../../features/settings/directory-sync-panel";

export const Route = createFileRoute("/settings/organization/directory-sync")({
  component: DirectorySyncPanel,
});
