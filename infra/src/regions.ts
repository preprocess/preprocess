// Region is configuration (spec 16d). Every deployed stage names its region
// with PREPROCESS_REGION in the deploy environment; nothing in the stack picks
// one. This table maps each region we run in to the provider locations its
// resources use. Adding a region adds an entry here and a PlanetScale database
// created in that region (PLANETSCALE_DATABASE), nothing else.

import type * as Cloudflare from "@alchemy.run/cloudflare";

type RegionConfig = {
  // Where Cloudflare places the stage's R2 bucket.
  r2LocationHint: Cloudflare.R2.Bucket.Location;
  // The cloud region of the region's PlanetScale databases. The API runs
  // beside them, so its many sequential queries per request stay local.
  databaseRegion: string;
};

export const regions: Record<string, RegionConfig> = {
  us: { r2LocationHint: "wnam", databaseRegion: "aws:us-west-2" },
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
