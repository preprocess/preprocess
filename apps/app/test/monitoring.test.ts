// Product analytics in the browser (PRE-160): feature_viewed's surfaces come
// from the registry in @preprocess/logs, and web vitals lose their URLs'
// queries like every other event.

import { PRODUCT_EVENTS } from "@preprocess/logs";
import { describe, expect, it } from "vitest";

import { surfaceOf } from "../src/features/monitoring/feature-surfaces";
import { scrubEvent } from "../src/features/monitoring/posthog";

describe("feature_viewed", () => {
  it("names a registered surface for the main routes only", () => {
    const allowed: readonly string[] = PRODUCT_EVENTS.feature_viewed.surface;
    for (const route of [
      "/inbox",
      "/agents/$agentId_/cases/$caseId",
      "/settings/organization/billing",
      "/settings/organization/api-keys",
    ])
      expect(allowed).toContain(surfaceOf(route));
    expect(surfaceOf("/sign-in")).toBeUndefined();
    expect(surfaceOf("/developers/api-keys")).toBeUndefined();
  });
});

describe("scrubEvent", () => {
  it("takes the query and hash out of each web vital's URLs", () => {
    const event = scrubEvent({
      uuid: "1",
      event: "$web_vitals",
      properties: {
        $current_url: "https://app.test/cases?q=acme",
        $web_vitals_LCP_value: 1200,
        $web_vitals_LCP_event: {
          name: "LCP",
          value: 1200,
          $current_url: "https://app.test/cases?q=acme#top",
          navigationURL: "https://app.test/cases?q=acme",
        },
      },
    });
    expect(event?.properties).toEqual({
      $current_url: "https://app.test/cases",
      $web_vitals_LCP_value: 1200,
      $web_vitals_LCP_event: {
        name: "LCP",
        value: 1200,
        $current_url: "https://app.test/cases",
        navigationURL: "https://app.test/cases",
      },
    });
  });
});
