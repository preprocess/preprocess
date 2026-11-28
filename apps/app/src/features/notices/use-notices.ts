import { useQuery, useQueryClient } from "@tanstack/react-query";

import { currentScenario } from "../../scenarios/current-scenario";
import { useOrganizationId } from "../auth/auth-context";
import { ApiError, apiFetch, orgApi } from "../auth/client";
import type { License } from "../settings/license-seed";
import { useAdministers } from "../settings/use-role";
import { buildNotices, seededNotices, type Billing } from "./notices";

const DISMISSED = ["notice-dismissals"];

type Dismissed = { ids: string[] };

/** The sidebar notice stack's notices, and dismissing an announcement. */
export function useNotices() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const seeded = seededNotices(currentScenario().notices);
  const administers = useAdministers();
  const billing = useQuery({
    queryKey: ["billing", organizationId],
    enabled: !seeded,
    queryFn: async () => {
      try {
        return await orgApi<Billing>(organizationId, "/billing");
      } catch (cause) {
        // Billing is off here.
        if (cause instanceof ApiError && cause.status === 404) return null;
        throw cause;
      }
    },
  });
  // Self-hosted only: our cloud answers 404. Members never ask.
  const license = useQuery({
    queryKey: ["license-notice", organizationId],
    enabled: !seeded && administers === true,
    retry: false,
    queryFn: async () => {
      try {
        return await orgApi<License>(organizationId, "/license");
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) return null;
        throw cause;
      }
    },
  });
  const dismissed = useQuery({
    queryKey: DISMISSED,
    queryFn: () => apiFetch<Dismissed>("/v1/me/notices/dismissed"),
  });

  // Billing notices wait for the person's role, and announcements for their
  // dismissals, so neither flashes the wrong item first.
  const live = {
    billing: billing.data ?? null,
    license: license.data ?? null,
    administers,
  };
  const {
    billing: source,
    license: installLicense,
    administers: manager,
  } = seeded ?? live;
  const notices = buildNotices({
    billing: manager === undefined ? null : source,
    license: manager === true ? installLicense : null,
    administers: manager === true,
    dismissed: new Set(dismissed.data?.ids),
    announcements: Boolean(dismissed.data) && (seeded?.announcements ?? true),
  });

  const dismiss = (id: string) => {
    queryClient.setQueryData<Dismissed>(DISMISSED, (old) => ({
      ids: [...(old?.ids ?? []), id],
    }));
    void apiFetch(`/v1/me/notices/dismissed/${encodeURIComponent(id)}`, {
      method: "PUT",
    }).catch(() => queryClient.invalidateQueries({ queryKey: DISMISSED }));
  };

  return { notices, dismiss };
}
