import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  checkConnectionBudget,
  CONNECTION_HEADROOM,
  originConnectionLimits,
} from "../src/connections.ts";

// Every PlanetScale branch we deploy to: max_connections 25, 3 reserved for
// superusers (PRE-81).
const planetscale = { maxConnections: 25, reserved: 3 };

describe("Hyperdrive connection budget", () => {
  it("fits both pools on a PlanetScale branch with headroom", () => {
    expect(() => checkConnectionBudget(planetscale)).not.toThrow();
    expect(
      originConnectionLimits.app +
        originConnectionLimits.system +
        CONNECTION_HEADROOM,
    ).toBeLessThanOrEqual(planetscale.maxConnections - planetscale.reserved);
  });

  it("keeps each limit at Hyperdrive's minimum of 5 or more", () => {
    expect(originConnectionLimits.app).toBeGreaterThanOrEqual(5);
    expect(originConnectionLimits.system).toBeGreaterThanOrEqual(5);
  });

  it("fails the deploy when the server can't take both pools", () => {
    expect(() =>
      checkConnectionBudget({ maxConnections: 20, reserved: 3 }),
    ).toThrow(/Hyperdrive may open 18 connections/);
  });

  it("declares the limits on both Hyperdrive configs", () => {
    const stack = readFileSync(
      new URL("../alchemy.run.ts", import.meta.url),
      "utf8",
    );
    expect(stack).toContain(
      "originConnectionLimit: originConnectionLimits.app",
    );
    expect(stack).toContain(
      "originConnectionLimit: originConnectionLimits.system",
    );
  });

  it("updates neither config before the guard passes", () => {
    const stack = readFileSync(
      new URL("../alchemy.run.ts", import.meta.url),
      "utf8",
    );
    expect(stack).toContain("app: Output.map(granted, ({ app }) => app)");
    expect(stack).toContain(
      "system: Output.map(granted, ({ system }) => system)",
    );
  });
});
