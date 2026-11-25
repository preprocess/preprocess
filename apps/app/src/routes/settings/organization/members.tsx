import { createFileRoute } from "@tanstack/react-router";

import { MembersPanel } from "../../../features/settings/members-panel";

export const Route = createFileRoute("/settings/organization/members")({
  component: MembersPanel,
});
