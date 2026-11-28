// Where sign-in, sign-up and onboarding send a person afterwards (PRE-144):
// any same-origin path, and nowhere else.

import { describe, expect, it } from "vitest";

import {
  safeRedirect,
  signedInRedirect,
} from "../src/features/auth/safe-redirect";

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

// A signed-in person who opens sign-in or sign-up (PRE-175).
describe("signedInRedirect", () => {
  it("keeps the page they were signing in for", () => {
    expect(signedInRedirect("/invitations/inv_1")).toBe("/invitations/inv_1");
    expect(signedInRedirect("/device?user_code=ABCD-EFGH")).toBe(
      "/device?user_code=ABCD-EFGH",
    );
  });

  it("goes home instead of another signed-out page or another host", () => {
    for (const value of [
      undefined,
      "/sign-in",
      "/sign-up?redirect=/sign-in",
      "/sign-in/",
      "//evil.example/",
    ])
      expect(signedInRedirect(value), String(value)).toBe("/");
  });
});
