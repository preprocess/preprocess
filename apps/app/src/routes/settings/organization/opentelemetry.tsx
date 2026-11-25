import { createFileRoute } from "@tanstack/react-router";

import { OtelExportPanel } from "../../../features/settings/otel-export-panel";

export const Route = createFileRoute("/settings/organization/opentelemetry")({
  component: OtelExportPanel,
});
