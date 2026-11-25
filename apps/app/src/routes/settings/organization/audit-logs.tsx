import { createFileRoute } from "@tanstack/react-router";

import { AuditLogPanel } from "../../../features/settings/audit-log-panel";

export const Route = createFileRoute("/settings/organization/audit-logs")({
  component: AuditLogPanel,
});
