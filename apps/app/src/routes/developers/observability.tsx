import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "../../components/placeholder-page";

export const Route = createFileRoute("/developers/observability")({
  component: DevelopersObservabilityPage,
});

function DevelopersObservabilityPage() {
  return (
    <PlaceholderPage
      description="Runs, errors, latency, and cost across every agent."
      title="Observability"
    />
  );
}
