import { describe, expect, it } from "vitest";

import { agent } from "../src/index.ts";
import type { AgentDefinition } from "../src/index.ts";

const base = { instructions: "Run code.", tools: {} };
const build = (sandbox: unknown) =>
  agent({ ...base, sandbox } as AgentDefinition<never>);

describe("sandbox", () => {
  it("is absent unless the code asks for one", () => {
    const { manifest } = agent(base);
    expect(manifest.sandbox).toBeUndefined();
    expect(manifest.declared).not.toContain("sandbox.size");
  });

  it("requires a size", () => {
    expect(() => build({})).toThrow(
      /sandbox\.size is required: pick one of small, medium, large/,
    );
    expect(() => build({ preset: "python" })).toThrow(/sandbox\.size/);
    expect(() => build({ size: "huge" })).toThrow(
      /sandbox\.size must be one of small, medium, large/,
    );
  });

  it("fills in the preset, packages and idle timeout", () => {
    const { manifest } = build({ size: "small" });
    expect(manifest.sandbox).toEqual({
      size: "small",
      preset: "standard",
      packages: { apt: [], pip: [], npm: [] },
      idleTimeoutMinutes: 5,
    });
    expect(manifest.declared).toContain("sandbox.size");
  });

  it("keeps a valid preset, package list and idle timeout", () => {
    const { manifest } = build({
      size: "large",
      preset: "python-data",
      packages: { apt: ["poppler-utils"], pip: ["pdfplumber==0.11.4"] },
      idleTimeoutMinutes: 60,
    });
    expect(manifest.sandbox).toEqual({
      size: "large",
      preset: "python-data",
      packages: {
        apt: ["poppler-utils"],
        pip: ["pdfplumber==0.11.4"],
        npm: [],
      },
      idleTimeoutMinutes: 60,
    });
  });

  it("caps the idle timeout at 60 minutes", () => {
    expect(() => build({ size: "small", idleTimeoutMinutes: 61 })).toThrow(
      /idleTimeoutMinutes must be a whole number from 1 to 60/,
    );
    expect(() => build({ size: "small", idleTimeoutMinutes: 0 })).toThrow(
      /idleTimeoutMinutes/,
    );
  });

  it("refuses package names that could pass a flag", () => {
    expect(() =>
      build({ size: "small", packages: { apt: ["--allow-unauthenticated"] } }),
    ).toThrow(/invalid package/);
    expect(() =>
      build({
        size: "small",
        preset: "python",
        packages: { pip: ["--index-url=https://evil.example"] },
      }),
    ).toThrow(/invalid package/);
    expect(() =>
      build({ size: "small", packages: { cargo: ["ripgrep"] } }),
    ).toThrow(/is not apt, pip or npm/);
  });

  it("needs the matching preset for pip and npm packages", () => {
    expect(() =>
      build({ size: "small", packages: { pip: ["requests"] } }),
    ).toThrow(/pip needs the "python" or "python-data" preset/);
    expect(() =>
      build({ size: "small", preset: "python", packages: { npm: ["zod"] } }),
    ).toThrow(/npm needs the "node" preset/);
    expect(
      build({
        size: "small",
        preset: "node",
        packages: { npm: ["@scope/pkg@1.2.3"] },
      }).manifest.sandbox?.packages.npm,
    ).toEqual(["@scope/pkg@1.2.3"]);
  });
});
