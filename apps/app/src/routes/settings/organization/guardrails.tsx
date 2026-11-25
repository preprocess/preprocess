import { createFileRoute } from "@tanstack/react-router";

import { GuardrailsPanel } from "../../../features/settings/guardrails-panel";

export const Route = createFileRoute("/settings/organization/guardrails")({
  validateSearch: (search: Record<string, unknown>): { request?: string } =>
    typeof search.request === "string" ? { request: search.request } : {},
  component: OrganizationGuardrails,
});

function OrganizationGuardrails() {
  return <GuardrailsPanel request={Route.useSearch().request} />;
}
