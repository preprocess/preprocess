// Where sign-in, sign-up and onboarding send a person afterwards (PRE-144):
// any same-origin path, and nowhere else.

import { describe, expect, it } from "vitest";

import { safeRedirect } from "../src/features/auth/safe-redirect";

describe("safeRedirect", () => {
  it("keeps a same-origin path with its query and hash", () => {
    expect(safeRedirect("/device?user_code=ABCD-EFGH")).toBe(
      "/device?user_code=ABCD-EFGH",
    );
    expect(safeRedirect("/agents/invoices/cases/c_1#thread")).toBe(
      "/agents/invoices/cases/c_1#thread",
    );
  });

  it("sends anything that could leave the app home", () => {
    for (const value of [
      undefined,
      null,
      42,
      "",
      "device",
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example/",
      "\\/evil.example/",
      "/\t/evil.example/",
      "/\n/evil.example/",
      "javascript:alert(1)",
    ])
      expect(safeRedirect(value), String(value)).toBe("/");
  });
});
