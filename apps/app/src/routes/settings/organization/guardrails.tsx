import { createFileRoute } from "@tanstack/react-router";

import { GuardrailsPanel } from "../../../features/settings/guardrails-panel";

export const Route = createFileRoute("/settings/organization/guardrails")({
  component: GuardrailsPanel,
});
