// Entitlements (spec 16): the one reader. On our cloud Autumn supplies the
// plan (billing.ts); until an organization starts one, or where billing is
// off, it is on the free plan with every paid feature refused and no limit.

import type { OrgId } from "@preprocess/db/client";
import { HTTPException } from "hono/http-exception";

import { cloudPlan } from "./billing.ts";
import type { Env } from "./env.ts";

export const paidFeatures = [
  "audit_export",
  "sso",
  "scim",
  "synced_groups",
  "custom_roles",
] as const;
export type Feature = (typeof paidFeatures)[number];
export type Limit = "seats";

export type Plan = {
  name: "free" | "team" | "enterprise";
  features: readonly Feature[];
  limits: { seats: number | null };
  has(feature: Feature): boolean;
  assert(feature: Feature): void;
  exceeds(limit: Limit, value: number): boolean;
};

const plan = (
  name: Plan["name"],
  features: readonly Feature[],
  limits: Plan["limits"],
): Plan => ({
  name,
  features,
  limits,
  has: (feature) => features.includes(feature),
  assert(feature) {
    if (!features.includes(feature))
      throw new HTTPException(403, {
        message: `${feature} is not included in the ${name} plan`,
      });
  },
  exceeds: (limit, value) => limits[limit] !== null && value > limits[limit],
});

const free = plan("free", [], { seats: null });

export const getPlan = async (env: Env, org: OrgId): Promise<Plan> => {
  const cloud = await cloudPlan(env, org);
  if (!cloud) return free;
  return plan(
    cloud.name,
    paidFeatures.filter((f) => cloud.features.has(f)),
    { seats: cloud.seats },
  );
};
