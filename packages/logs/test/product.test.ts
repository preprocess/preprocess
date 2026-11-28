import { describe, expect, it } from "vitest";

import {
  amountBucket,
  durationBucket,
  organizationIdentify,
  personIdentify,
  PRODUCT_EVENTS,
  productEvent,
  type PropertySpec,
  validValue,
} from "../src/product.ts";

const KINDS = ["id", "id?", "count", "flag", "slug"];
// Names that would invite content, people or free text into a property.
const CONTENT_NAMES =
  /text|message|content|prompt|body|title|name|email|note|reason|answer|query|url|path|description|label/;
// An enum value is a short token, never a sentence.
const TOKEN = /^[a-z][a-z0-9_]{0,30}$/;

const org = "org_01m8g4sjmtesmbxhkbpn9yywtx";
const user = "usr_01m8g4sjmtesmbxhkbpn9yywty";
const agent = "agt_01m8g4sjmtesmbxhkbpn9yywtz";
const kase = "case_01m8g4sjmtesmbxhkbpn9yywv0";

describe("the product event catalogue", () => {
  it("names every event as a snake_case token", () => {
    for (const event of Object.keys(PRODUCT_EVENTS))
      expect(event).toMatch(TOKEN);
  });

  it("allows only ids, counts, flags and enums, never free text", () => {
    for (const [event, properties] of Object.entries(PRODUCT_EVENTS))
      for (const [name, spec] of Object.entries(
        properties as Record<string, PropertySpec>,
      )) {
        expect(name, `${event}.${name}`).not.toMatch(CONTENT_NAMES);
        if (typeof spec === "string")
          expect(KINDS, `${event}.${name}`).toContain(spec);
        else
          for (const value of spec)
            expect(value, `${event}.${name}`).toMatch(TOKEN);
      }
  });
});

describe("validValue", () => {
  it("takes our ids and rejects text, emails and other people's ids", () => {
    expect(validValue("id", kase)).toBe(true);
    expect(validValue("id", "Invoice 4411 from ACME")).toBe(false);
    expect(validValue("id", "jane@example.com")).toBe(false);
    expect(validValue("id", "12345")).toBe(false);
    expect(validValue("id?", null)).toBe(true);
    expect(validValue("id", null)).toBe(false);
  });

  it("takes whole counts, flags and listed enum values only", () => {
    expect(validValue("count", 3)).toBe(true);
    expect(validValue("count", 2.5)).toBe(false);
    expect(validValue("count", "3")).toBe(false);
    expect(validValue("flag", true)).toBe(true);
    expect(validValue("flag", "yes")).toBe(false);
    expect(validValue(["cli", "github"], "github")).toBe(true);
    expect(validValue(["cli", "github"], "please deploy")).toBe(false);
  });
});

describe("slugs and buckets", () => {
  it("takes short lowercase tokens, never sentences or emails", () => {
    expect(validValue("slug", "claude-opus-5-5")).toBe(true);
    expect(validValue("slug", "/v1/agents/{id}/cases")).toBe(true);
    expect(validValue("slug", "news.ycombinator.com")).toBe(true);
    expect(validValue("slug", "Please summarise this")).toBe(false);
    expect(validValue("slug", "jane@example.com")).toBe(false);
    expect(validValue("slug", "x".repeat(81))).toBe(false);
  });

  it("buckets durations and amounts", () => {
    expect(durationBucket(0)).toBe("lt_10s");
    expect(durationBucket(10_000)).toBe("s10_to_1m");
    expect(durationBucket(90_000_000)).toBe("gt_1d");
    expect(amountBucket(0)).toBe("zero");
    expect(amountBucket(0.4)).toBe("lt_1");
    expect(amountBucket(1)).toBe("n1_to_10");
    expect(amountBucket(250)).toBe("n100_to_1k");
    expect(amountBucket(50_000)).toBe("gt_10k");
  });
});

describe("productEvent", () => {
  it("groups by organization and drops anything that isn't allowed", () => {
    const event = productEvent(
      { STAGE: "staging" },
      "operator_replied",
      org,
      user,
      {
        case_id: kase,
        agent_id: agent,
        mentions: 1,
        text: "the customer's message",
      } as never,
    );
    expect(event.event).toBe("operator_replied");
    expect(event.distinctId).toBe(user);
    expect(event.properties).toEqual({
      case_id: kase,
      agent_id: agent,
      mentions: 1,
      organization_id: org,
      $groups: { organization: org },
      stage: "staging",
      service: "api",
      $geoip_disable: true,
    });
  });

  it("is the organization's, and still grouped, when nobody acted", () => {
    const event = productEvent({}, "case_completed", org, null, {
      case_id: kase,
      agent_id: agent,
      outcome: "completed",
    });
    expect(event.distinctId).toBe(org);
    expect(event.properties.$process_person_profile).toBeUndefined();
    expect(event.properties.$groups).toEqual({ organization: org });
  });

  it("sets only the listed person properties, and only for a person", () => {
    const event = productEvent(
      {},
      "signed_up",
      null,
      user,
      { method: "google" },
      {
        $set_once: {
          signup_method: "google",
          first_seen: "2026-11-28T05:00:00.000Z",
        },
        $set: { role: "chief", email: "jane@example.com" } as never,
      },
    );
    expect(event.properties.$set_once).toEqual({
      signup_method: "google",
      first_seen: "2026-11-28T05:00:00.000Z",
    });
    expect(event.properties.$set).toBeUndefined();
    const nobody = productEvent(
      {},
      "case_completed",
      org,
      null,
      { case_id: kase, agent_id: agent, outcome: "completed" },
      { $set: { role: "owner" } },
    );
    expect(nobody.properties.$set).toBeUndefined();
    expect(personIdentify(user, { role: "admin" })).toMatchObject({
      event: "$set",
      distinctId: user,
      properties: { $set: { role: "admin" } },
    });
  });

  it("sets the organization group's plan, seats and created_at", () => {
    const event = organizationIdentify(org, {
      plan: "team",
      seats: 4,
      created_at: "2026-11-01T00:00:00.000Z",
    });
    expect(event.event).toBe("$groupidentify");
    expect(event.properties).toMatchObject({
      $group_type: "organization",
      $group_key: org,
      $group_set: { plan: "team", seats: 4 },
    });
  });
});
