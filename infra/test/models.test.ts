import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { callsRealModels } from "../src/stages.ts";

describe("which stages call real model providers", () => {
  it("never calls them from a preview, even when asked", () => {
    expect(callsRealModels("pr-42", false)).toBe(false);
    expect(callsRealModels("pr-42", true)).toBe(false);
  });

  it("calls them from staging only when the deploy asks", () => {
    expect(callsRealModels("staging", false)).toBe(false);
    expect(callsRealModels("staging", true)).toBe(true);
  });

  it("keeps production and self-hosted installs on their providers", () => {
    expect(callsRealModels("production", false)).toBe(true);
    expect(callsRealModels("selfhost", false)).toBe(true);
    expect(callsRealModels("selfhost-acme", false)).toBe(true);
  });

  it("binds provider keys and Workers AI only behind that decision", () => {
    const stack = readFileSync(
      new URL("../alchemy.run.ts", import.meta.url),
      "utf8",
    ).replace(/\s+/g, " ");
    const count = (text: string) => stack.split(text).length - 1;
    expect(count("optionalSecrets(runtimeModelSecrets)")).toBe(1);
    expect(count("optionalSecrets(apiModelSecrets)")).toBe(1);
    expect(count("Cloudflare.Workers.AI()")).toBe(1);
    expect(stack).toContain(
      "...(realModels && { ...optionalSecrets(runtimeModelSecrets), AI: Cloudflare.Workers.AI(), })",
    );
    expect(stack).toContain(
      "...(realModels && optionalSecrets(apiModelSecrets))",
    );
    expect(stack).toMatch(/const modelStub = !realModels \|\|/);
  });
});
