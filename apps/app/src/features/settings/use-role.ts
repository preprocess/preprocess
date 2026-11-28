import { useQuery } from "@tanstack/react-query";

import { useAuth, useOrganizationId } from "../auth/auth-context";
import { apiFetch, orgApi } from "../auth/client";

/**
 * Whether the signed-in person is an Owner or Admin of the active
 * organization; undefined until their role has loaded.
 */
export function useAdministers() {
  const organizationId = useOrganizationId();
  const member = useQuery({
    queryKey: ["active-member", organizationId],
    queryFn: () =>
      apiFetch<{ role: string }>(
        `/api/auth/organization/get-active-member-role?organizationId=${encodeURIComponent(organizationId)}`,
      ),
  });
  return member.data?.role
    .split(",")
    .some((r) => r === "owner" || r === "admin");
}

/** Whether the signed-in person is the active organization's Owner. */
export function useOwns() {
  const organizationId = useOrganizationId();
  const member = useQuery({
    queryKey: ["active-member", organizationId],
    queryFn: () =>
      apiFetch<{ role: string }>(
        `/api/auth/organization/get-active-member-role?organizationId=${encodeURIComponent(organizationId)}`,
      ),
  });
  return member.data?.role.split(",").includes("owner") ?? false;
}

/** Whether the signed-in person is an Owner or Admin of the active organization. */
export function useCanAdminister() {
  return useAdministers() ?? false;
}

/**
 * Whether the signed-in person may deploy, promote and roll back: Owners,
 * Admins and the Developers group, as the API checks.
 */
export function useCanDeploy() {
  const organizationId = useOrganizationId();
  const { user } = useAuth();
  const canAdminister = useCanAdminister();
  const developer = useQuery({
    queryKey: ["developer", organizationId, user?.id],
    enabled: !canAdminister && Boolean(user),
    queryFn: async () => {
      const [members, groups] = await Promise.all([
        orgApi<{ userId: string; groups: { id: string }[] }[]>(
          organizationId,
          "/members",
        ),
        orgApi<{ id: string; isDevelopers: boolean }[]>(
          organizationId,
          "/groups",
        ),
      ]);
      const mine = new Set(
        members.find((m) => m.userId === user?.id)?.groups.map((g) => g.id),
      );
      return groups.some((g) => g.isDevelopers && mine.has(g.id));
    },
  });
  return canAdminister || developer.data === true;
}
