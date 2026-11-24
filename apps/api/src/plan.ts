// Entitlements (spec 16): the one reader. Until billing (step 9) every
// organization is on the free plan, on our cloud and self-hosted alike, so
// every paid feature is refused and no limit applies.

import type { OrgId } from "@preprocess/db/client";
import { HTTPException } from "hono/http-exception";

export const paidFeatures = [
  "audit_export",
  "sso",
  "scim",
  "synced_groups",
  "custom_roles",
] as const;
export type Feature = (typeof paidFeatures)[number];
export type Limit = "members";

export type Plan = {
  name: "free";
  features: readonly Feature[];
  has(feature: Feature): boolean;
  assert(feature: Feature): void;
  exceeds(limit: Limit, value: number): boolean;
};

const free: Plan = {
  name: "free",
  features: [],
  has: () => false,
  assert(feature) {
    throw new HTTPException(403, {
      message: `${feature} is not included in the ${free.name} plan`,
    });
  },
  exceeds: () => false,
};

export const getPlan = (_org: OrgId): Plan => free;
