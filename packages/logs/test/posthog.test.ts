import { describe, expect, it } from "vitest";

import { posthogConfig, routeOf, scrub, toPostHog } from "../src/posthog.ts";

const event = (fields: Record<string, unknown>) => ({
  timestamp: "2026-11-28T10:00:00.000Z",
  level: "info" as const,
  service: "api",
  environment: "production",
  ...fields,
});

describe("posthogConfig", () => {
  it("is off without a key, as on staging, previews and most self-hosted installs", () => {
    expect(posthogConfig({ STAGE: "staging" })).toBeNull();
  });

  it("defaults to PostHog's US cloud and a full sample", () => {
    expect(
      posthogConfig({ POSTHOG_KEY: "phc_x", STAGE: "production" }),
    ).toEqual({
      key: "phc_x",
      host: "https://us.i.posthog.com",
      sampleRate: 1,
      stage: "production",
    });
  });
});

describe("toPostHog", () => {
  it("sends a request's route, status, duration and organization, nothing else", () => {
    const { request, exception } = toPostHog(
      "api",
      event({
        method: "POST",
        path: "/v1/orgs/org_01m8ar0hemfahb99w1a60fp0a7/cases",
        route: "/v1/orgs/:org/cases",
        status: 202,
        durationMs: 41,
        organizationId: "org_01m8ar0hemfahb99w1a60fp0a7",
        requestId: "r1",
        input: { text: "invoice for ACME" },
      }),
    );
    expect(request).toEqual({
      timestamp: "2026-11-28T10:00:00.000Z",
      level: "info",
      service: "api",
      method: "POST",
      route: "/v1/orgs/:org/cases",
      status: 202,
      durationMs: 41,
      organizationId: "org_01m8ar0hemfahb99w1a60fp0a7",
      sampleRate: 1,
    });
    expect(exception).toBeNull();
  });

  it("samples request events but never exceptions", () => {
    const { request, exception } = toPostHog(
      "app",
      event({ method: "GET", path: "/cases", status: 500, level: "error" }),
      0.1,
      () => 0.5,
    );
    expect(request).toBeNull();
    expect(exception).not.toBeNull();
  });

  it("scrubs an error's message and keeps its stack frames", () => {
    const { exception } = toPostHog(
      "api",
      event({
        level: "error",
        method: "POST",
        path: "/api/auth/sign-in",
        status: 500,
        error: {
          name: "PostgresError",
          message:
            'duplicate key: Key (email)=(ann@acme.com) already exists in "users"',
          stack:
            "PostgresError: duplicate\n    at insert (index.js:10:3)\n    at run (index.js:20:1)",
        },
      }),
    );
    expect(exception?.$exception_list).toEqual([
      {
        type: "PostgresError",
        value: "duplicate key: Key (<value>) already exists in <value>",
        mechanism: { handled: true, synthetic: false },
      },
    ]);
    expect(exception?.stack).toBe(
      "at insert (index.js:10:3)\nat run (index.js:20:1)",
    );
  });

  it("sends no text for an event about a case", () => {
    const { exception } = toPostHog(
      "runtime",
      event({
        level: "error",
        operation: "case.run",
        organizationId: "org_a",
        caseId: "case_1",
        message: "Case failed",
        error: {
          message: "Customer SSN 123-45-6789 not found",
          stack: "Error: x\n    at tool (agent.js:1:1)",
        },
      }),
    );
    expect(JSON.stringify(exception)).not.toContain("SSN");
    expect(exception).toMatchObject({
      operation: "case.run",
      organizationId: "org_a",
      $exception_list: [{ type: "case.run", value: "case.run" }],
    });
    expect(exception).not.toHaveProperty("stack");
  });
});

describe("routeOf and scrub", () => {
  it("groups ids in a path", () => {
    expect(routeOf("/agents/agt_01m8x9k2/cases/42")).toBe(
      "/agents/:id/cases/:id",
    );
    expect(routeOf("/settings/billing")).toBe("/settings/billing");
  });

  it("drops values from free text", () => {
    expect(scrub("fetch https://x.io/a?token=abc failed for 1234567")).toBe(
      "fetch https://x.io/a?<query> failed for <number>",
    );
  });
});
