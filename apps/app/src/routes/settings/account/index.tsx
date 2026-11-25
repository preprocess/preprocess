import { createFileRoute } from "@tanstack/react-router";

import { ProfilePanel } from "../../../features/settings/profile-panel";

export const Route = createFileRoute("/settings/account/")({
  component: ProfilePanel,
});
