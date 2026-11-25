import { useQuery } from "@tanstack/react-query";

import { useOrganizationId } from "../auth/auth-context";
import { apiFetch } from "../auth/client";

/** Whether the signed-in person is an Owner or Admin of the active organization. */
export function useCanAdminister() {
  const organizationId = useOrganizationId();
  const member = useQuery({
    queryKey: ["active-member", organizationId],
    queryFn: () =>
      apiFetch<{ role: string }>(
        `/api/auth/organization/get-active-member-role?organizationId=${encodeURIComponent(organizationId)}`,
      ),
  });
  const role = member.data?.role ?? "member";
  return role.split(",").some((r) => r === "owner" || r === "admin");
}
