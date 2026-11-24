import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import worker, { allowed, type Egress } from "../src/index.ts";

const rules = (allow: string[], block: string[]) =>
  JSON.stringify({ allow, block });

describe("network rules", () => {
  it("blocks listed hosts and wildcard subdomains", () => {
    const r = { allow: [], block: ["example.com", "*.evil.test"] };
    expect(allowed("example.com", r)).toBe(false);
    expect(allowed("a.evil.test", r)).toBe(false);
    expect(allowed("evil.test", r)).toBe(false);
    expect(allowed("notevil.test", r)).toBe(true);
    expect(allowed("cloudflare.com", r)).toBe(true);
  });

  it("allows only listed hosts when an allow list is set, and block wins", () => {
    const r = { allow: ["*.acme.test"], block: ["secret.acme.test"] };
    expect(allowed("api.acme.test", r)).toBe(true);
    expect(allowed("secret.acme.test", r)).toBe(false);
    expect(allowed("other.test", r)).toBe(false);
  });

  it("answers 403 for a blocked host and forwards the rest", async () => {
    const params = {
      organizationId: "org_a",
      network: rules([], ["example.com"]),
    };
    const blocked = await worker.fetch(
      new Request("https://example.com/"),
      params,
    );
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({
      host: "example.com",
      organizationId: "org_a",
    });
    const passed = await worker.fetch(new Request("https://ok.test/"), params);
    expect(await passed.json()).toEqual({ reached: "ok.test" });
  });

  it("applies each organization's own rules", async () => {
    const egress = (exports as unknown as { Egress: Pick<Egress, "fetchAs"> })
      .Egress;
    const a = await egress.fetchAs(
      { organizationId: "org_a", network: rules([], ["example.com"]) },
      new Request("https://example.com/"),
    );
    const b = await egress.fetchAs(
      { organizationId: "org_b", network: rules([], []) },
      new Request("https://example.com/"),
    );
    expect([a.status, b.status]).toEqual([403, 200]);
  });
});
