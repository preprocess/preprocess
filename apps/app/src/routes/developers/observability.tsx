import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "../../components/placeholder-page";

export const Route = createFileRoute("/developers/observability")({
  component: DevelopersObservabilityPage,
});

function DevelopersObservabilityPage() {
  return (
    <PlaceholderPage
      description="Organization-wide traces and metrics will live here. Per-agent run logs and OpenTelemetry export are available today."
      emptyTitle="Observability is coming soon"
      title="Observability"
    />
  );
}
