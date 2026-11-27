import { createServerFn } from "@tanstack/react-start";

import { currentScenario } from "../../scenarios/current-scenario";
import { type Billing, billingShown } from "./billing-types";

/**
 * Whether Billing exists for this person: our cloud with billing on (GET
 * /billing answers 200), a started plan or billing that holds for the
 * organization, and the organization's Owner. Seeded scenarios in
 * development always show it.
 */
export const loadBillingAccess = createServerFn({ method: "GET" }).handler(
  async (): Promise<boolean> => {
    if (currentScenario().billing !== "live") return true;
    const { activeOrganizationId, activeOrgRequest, apiRequest } =
      await import("../../server/api.server");
    const member = await apiRequest(
      `/api/auth/organization/get-active-member-role?organizationId=${encodeURIComponent(await activeOrganizationId())}`,
    );
    if (!member.ok) return false;
    const { role } = await member.json<{ role: string }>();
    if (!role.split(",").includes("owner")) return false;
    const billing = await activeOrgRequest("/billing");
    if (!billing.ok) {
      await billing.body?.cancel();
      return false;
    }
    return billingShown(await billing.json<Billing>());
  },
);
