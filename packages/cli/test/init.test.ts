import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CLI_RANGE, SDK_RANGE, init } from "../src/init.ts";

const scratch = () => mkdtempSync(path.join(tmpdir(), "pp-init-"));

describe("preprocess init", () => {
  it("writes an agent project named after its directory", () => {
    const dir = path.join(scratch(), "Order Desk");
    const result = init({ dir });
    expect(result.code).toBe(0);
    const pkg = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as { name: string; dependencies: Record<string, string> };
    expect(pkg.name).toBe("order-desk");
    expect(pkg.dependencies["@preprocess/sdk"]).toBe(SDK_RANGE);
    expect(readFileSync(path.join(dir, "src/index.ts"), "utf8")).toContain(
      "export default agent({",
    );
    expect(existsSync(path.join(dir, "tsconfig.json"))).toBe(true);
    expect(result.out).toContain("Created agent order-desk");
  });

  it("never overwrites a file", () => {
    const dir = scratch();
    writeFileSync(path.join(dir, "package.json"), "{}");
    const result = init({ dir, name: "desk" });
    expect(result.code).toBe(1);
    expect(result.out).toContain("already has package.json");
    expect(readFileSync(path.join(dir, "package.json"), "utf8")).toBe("{}");
    expect(existsSync(path.join(dir, "src/index.ts"))).toBe(false);
  });

  it("starts projects on the SDK and CLI releases in this repository", () => {
    const version = (pkg: string) =>
      (
        JSON.parse(
          readFileSync(
            path.join(import.meta.dirname, "..", "..", pkg, "package.json"),
            "utf8",
          ),
        ) as { version: string }
      ).version;
    expect(SDK_RANGE).toBe(`^${version("sdk")}`);
    expect(CLI_RANGE).toBe(`^${version("cli")}`);
  });
});
