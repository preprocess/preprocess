import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { refuseIcebergLogs } from "../src/stages.ts";

// PRE-162: deleting an organization can't remove rows from the Iceberg log
// table yet, so nothing may turn that store on.
describe("Iceberg run logs", () => {
  it("are refused while deleting an organization can't remove them", () => {
    expect(refuseIcebergLogs(true)).toMatch(/PRE-162/);
    expect(refuseIcebergLogs(false)).toBeNull();
  });

  it("are turned on only behind the refusal", () => {
    const stack = readFileSync(
      new URL("../alchemy.run.ts", import.meta.url),
      "utf8",
    );
    const refusal = stack.indexOf("refuseIcebergLogs(logCatalogToken");
    expect(refusal).toBeGreaterThan(0);
    expect(stack.split('LOG_STORE: "sql"')).toHaveLength(2);
    expect(stack.indexOf('LOG_STORE: "sql"')).toBeGreaterThan(refusal);
    expect(stack.split("Cloudflare.Basin.Pipeline(")).toHaveLength(2);
    expect(stack.indexOf("Cloudflare.Basin.Pipeline(")).toBeGreaterThan(
      refusal,
    );
  });

  it("are never set by local development's config", () => {
    const wrangler = readFileSync(
      new URL("../../apps/api/wrangler.jsonc", import.meta.url),
      "utf8",
    );
    expect(wrangler).not.toMatch(/LOG_STORE|LOG_STREAM|pipelines/);
  });
});
