// License settings (spec 16, self-hosted only): the install's license and
// an Owner uploading a key. "live" reads and writes /v1 through server
// functions; in development the other "license" scenarios serve seeded
// licenses and answer uploads as the API would.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";

import { staleAfterWrite } from "../../lib/data-changed";
import { currentScenario } from "../../scenarios/current-scenario";
import { useOrganizationId } from "../auth/auth-context";
import { ApiError } from "../auth/client";
import { ACTIVE_LICENSE, seededLicense, type License } from "./license-seed";

export type LicenseRole = "owner" | "admin";

type Uploaded = { ok: true } | { ok: false; status: number; message: string };

/**
 * The signed-in person's role where the License page exists for them: a
 * self-hosted install (GET /license answers; our cloud answers 404) and an
 * Owner or Admin. Seeded license states always show it.
 */
export const loadLicenseRole = createServerFn({ method: "GET" }).handler(
  async (): Promise<LicenseRole | null> => {
    const state = currentScenario().license;
    if (state !== "live") return state === "admin" ? "admin" : "owner";
    const { activeOrganizationId, activeOrgRequest, apiRequest } =
      await import("../../server/api.server");
    const member = await apiRequest(
      `/api/auth/organization/get-active-member-role?organizationId=${encodeURIComponent(await activeOrganizationId())}`,
    );
    if (!member.ok) {
      await member.body?.cancel();
      return null;
    }
    const roles = (await member.json<{ role: string }>()).role.split(",");
    const role = roles.includes("owner")
      ? "owner"
      : roles.includes("admin")
        ? "admin"
        : null;
    if (!role) return null;
    const license = await activeOrgRequest("/license");
    await license.body?.cancel();
    return license.ok ? role : null;
  },
);

// Null on our cloud, which has no license (404).
const liveLicense = createServerFn({ method: "GET" }).handler(
  async (): Promise<License | null> => {
    const { activeOrgJson } = await import("../../server/api.server");
    return activeOrgJson<License | null>("/license", { notFound: null });
  },
);

const liveUpload = createServerFn({ method: "POST" })
  .middleware([staleAfterWrite])
  .validator((key: string) => key)
  .handler(async ({ data: key }): Promise<Uploaded> => {
    const { activeOrgRequest } = await import("../../server/api.server");
    const response = await activeOrgRequest("/license", {
      method: "PUT",
      body: JSON.stringify({ key }),
    });
    if (response.ok) {
      await response.body?.cancel();
      return { ok: true };
    }
    const body = await response
      .json<{ error?: { message?: string } }>()
      .catch(() => null);
    return {
      ok: false,
      status: response.status,
      message:
        body?.error?.message ?? `The request failed (${response.status}).`,
    };
  });

// Seeded uploads stick in memory until the page reloads.
const seededUploads = new Map<string, License>();

const INVALID_KEY =
  "This license key isn't valid. Check that you pasted the whole key.";

/** The install's license; null on our cloud. Live reads wait for enabled. */
export function useLicense(enabled = true) {
  const organizationId = useOrganizationId();
  const state = currentScenario().license;
  return useQuery({
    queryKey: ["license", organizationId, state],
    enabled: enabled || state !== "live",
    retry: false,
    queryFn: (): Promise<License | null> =>
      state === "live"
        ? liveLicense()
        : Promise.resolve(seededUploads.get(state) ?? seededLicense(state)),
  });
}

/** Uploads a key; a refusal throws with the API's message. */
export function useUploadLicense() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  return async (key: string) => {
    const state = currentScenario().license;
    if (state === "live") {
      const uploaded = await liveUpload({ data: key });
      if (!uploaded.ok) throw new ApiError(uploaded.message, uploaded.status);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (!/^[\w-]+\.[\w-]+$/.test(key)) throw new ApiError(INVALID_KEY, 400);
      seededUploads.set(state, {
        ...ACTIVE_LICENSE,
        uploadedAt: new Date().toISOString(),
      });
    }
    await queryClient.invalidateQueries({
      queryKey: ["license", organizationId],
    });
  };
}
