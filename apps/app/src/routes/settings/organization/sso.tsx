import { createFileRoute } from "@tanstack/react-router";

import { SsoPanel } from "../../../features/settings/sso-panel";

export const Route = createFileRoute("/settings/organization/sso")({
  component: SsoPanel,
});
