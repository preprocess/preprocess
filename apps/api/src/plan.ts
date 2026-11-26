// Entitlements (spec 16): the one reader. On our cloud Autumn supplies the
// plan (billing.ts); until an organization starts one, or where billing is
// off, it is on the free plan with every paid feature refused and no limit.
// A plan's seat limit holds only once billing is enforced (billing.ts).
// Self-hosted, the license key in PREPROCESS_LICENSE_KEY supplies one plan for
// the install: a valid key, or one in its 30 days of grace, gives its features
// and seat limit; no key, an invalid one or one past grace gives the free
// plan, whose product and data keep working.

import type { OrgId } from "@preprocess/db/client";
import { runMode } from "@preprocess/runmode";
import { HTTPException } from "hono/http-exception";

import { cloudPlan, seatLimitApplies } from "./billing.ts";
import type { Env } from "./env.ts";
import { readLicense } from "./license.ts";
import type { LicenseState } from "./license.ts";

export const paidFeatures = [
  "audit_export",
  "sso",
  "scim",
  "synced_groups",
  "custom_roles",
] as const;
export type Feature = (typeof paidFeatures)[number];
// Seats are developers plus operators (seats.ts); null is no limit.
export type Limit = "seats";

export type Plan = {
  name: "free" | "team" | "enterprise" | "internal" | "licensed";
  features: readonly Feature[];
  limits: Record<Limit, number | null>;
  // Self-hosted only: the key's state, for the admin warning.
  license: LicenseState | null;
  has(feature: Feature): boolean;
  assert(feature: Feature): void;
  exceeds(limit: Limit, value: number): boolean;
};

const plan = (
  name: Plan["name"],
  features: readonly Feature[],
  limits: Plan["limits"],
  license: LicenseState | null,
): Plan => ({
  name,
  features,
  limits,
  license,
  has: (feature) => features.includes(feature),
  assert(feature) {
    if (!features.includes(feature))
      throw new HTTPException(403, {
        message: `${feature} is not included in the ${name} plan`,
      });
  },
  exceeds(limit, value) {
    const max = limits[limit];
    return max !== null && value > max;
  },
});

const free = plan("free", [], { seats: null }, null);

export const getPlan = async (env: Env, org: OrgId): Promise<Plan> => {
  if (runMode(env).kind === "cloud") {
    const cloud = await cloudPlan(env, org);
    if (!cloud) return free;
    return plan(
      cloud.name,
      paidFeatures.filter((f) => cloud.features.has(f)),
      { seats: seatLimitApplies(env, org) ? cloud.seats : null },
      null,
    );
  }
  const license = await readLicense(env.PREPROCESS_LICENSE_KEY);
  if (license.status !== "active" && license.status !== "grace")
    return plan("free", [], { seats: null }, license);
  return plan(
    "licensed",
    paidFeatures.filter((f) => license.license.features.includes(f)),
    { seats: license.license.seats },
    license,
  );
};
