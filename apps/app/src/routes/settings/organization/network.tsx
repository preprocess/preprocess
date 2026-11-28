import { createFileRoute } from "@tanstack/react-router";

import { OrgNetworkSection } from "../../../features/developers/network-section";

export const Route = createFileRoute("/settings/organization/network")({
  component: OrgNetworkSection,
});
