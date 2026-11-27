import { createFileRoute, notFound } from "@tanstack/react-router";

import { loadBillingAccess } from "../../../features/billing/billing-access";
import { BillingPanel } from "../../../features/billing/billing-panel";

export const Route = createFileRoute("/settings/organization/billing")({
  loader: async () => {
    if (!(await loadBillingAccess())) throw notFound();
  },
  component: BillingPanel,
});
