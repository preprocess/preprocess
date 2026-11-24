// Region is configuration (spec 16d). Every deployed stage names its region
// with PREPROCESS_REGION in the deploy environment; nothing in the stack picks
// one. This table maps each region we run in to the provider locations its
// resources use. Adding a region adds an entry here and a PlanetScale database
// created in that region (PLANETSCALE_DATABASE), nothing else.

import type * as Cloudflare from "@alchemy.run/cloudflare";

type RegionConfig = {
  // Where Cloudflare places the stage's R2 bucket.
  r2LocationHint: Cloudflare.R2.Bucket.Location;
};

export const regions: Record<string, RegionConfig> = {
  us: { r2LocationHint: "wnam" },
};

export const regionConfig = (region: string): RegionConfig => {
  const config = regions[region];
  if (!config) {
    throw new Error(
      `Unknown PREPROCESS_REGION "${region}". Known regions: ${Object.keys(regions).join(", ")} (infra/src/regions.ts).`,
    );
  }
  return config;
};
