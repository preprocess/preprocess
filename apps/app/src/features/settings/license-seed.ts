// The License page's types and seeded states (spec 16, self-hosted only),
// shared with the sidebar notice stack.

import type { ScenarioState } from "../../scenarios/scenarios";

/** GET /v1/orgs/{org}/license. */
export type License = {
  status: "none" | "invalid" | "active" | "grace" | "expired";
  source: "upload" | "environment" | null;
  uploadedAt: string | null;
  customer: string | null;
  seats: { used: number; limit: number | null };
  expiresAt: string | null;
  graceEndsAt: string | null;
};

export const LICENSE_HREF = "/settings/organization/license";

const NO_LICENSE: License = {
  status: "none",
  source: null,
  uploadedAt: null,
  customer: null,
  seats: { used: 4, limit: null },
  expiresAt: null,
  graceEndsAt: null,
};

const licensed = (
  status: License["status"],
  expiresAt: string,
  graceEndsAt: string,
): License => ({
  status,
  source: "upload",
  uploadedAt: "2025-12-01T18:04:00.000Z",
  customer: "Acme Corp",
  seats: { used: 18, limit: 25 },
  expiresAt,
  graceEndsAt,
});

export const ACTIVE_LICENSE = licensed(
  "active",
  "2027-06-30T00:00:00.000Z",
  "2027-07-30T00:00:00.000Z",
);

/** A seeded state's license. */
export function seededLicense(
  state: Exclude<ScenarioState<"license">, "live">,
): License {
  switch (state) {
    case "active":
    case "admin":
      return ACTIVE_LICENSE;
    case "grace":
      return licensed(
        "grace",
        "2026-11-15T00:00:00.000Z",
        "2026-12-15T00:00:00.000Z",
      );
    case "expired":
      return licensed(
        "expired",
        "2026-10-01T00:00:00.000Z",
        "2026-10-31T00:00:00.000Z",
      );
    case "invalid":
      return {
        ...NO_LICENSE,
        status: "invalid",
        source: "environment",
      };
    case "none":
      return NO_LICENSE;
  }
}
