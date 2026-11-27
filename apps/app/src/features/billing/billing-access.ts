import { createServerFn } from "@tanstack/react-start";

import { currentScenario } from "../../scenarios/current-scenario";

/**
 * Whether Billing exists for this person: our cloud with billing on (GET
 * /billing answers 200) and the organization's Owner. Seeded scenarios in
 * development always show it.
 */
export const loadBillingAccess = createServerFn({ method: "GET" }).handler(
  async (): Promise<boolean> => {
    if (currentScenario().billing !== "live") return true;
    const { activeOrganizationId, activeOrgRequest, apiRequest } =
      await import("../../server/api.server");
    const billing = await activeOrgRequest("/billing");
    await billing.body?.cancel();
    if (!billing.ok) return false;
    const member = await apiRequest(
      `/api/auth/organization/get-active-member-role?organizationId=${encodeURIComponent(await activeOrganizationId())}`,
    );
    if (!member.ok) return false;
    const { role } = await member.json<{ role: string }>();
    return role.split(",").includes("owner");
  },
);
