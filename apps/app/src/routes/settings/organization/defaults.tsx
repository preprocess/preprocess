import { createFileRoute } from "@tanstack/react-router";

import { DefaultsPanel } from "../../../features/settings/defaults-panel";

export const Route = createFileRoute("/settings/organization/defaults")({
  component: DefaultsPanel,
});
