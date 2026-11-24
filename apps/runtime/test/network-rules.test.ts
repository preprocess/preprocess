import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { allowed, type OutboundProps } from "../src/outbound.ts";

const outbound = (props: OutboundProps) =>
  (
    exports as unknown as {
      Outbound(options: { props: OutboundProps }): Fetcher;
    }
  ).Outbound({ props });

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

  it("answers 403 for a blocked host and forwards the rest, per organization", async () => {
    const a = outbound({
      organizationId: "org_a",
      network: { allow: [], block: ["example.com"] },
    });
    const blocked = await a.fetch("https://example.com/");
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({
      host: "example.com",
      organizationId: "org_a",
    });
    const passed = await a.fetch("https://ok.test/");
    expect(await passed.text()).toBe("reached ok.test");
    const b = outbound({
      organizationId: "org_b",
      network: { allow: [], block: [] },
    });
    expect((await b.fetch("https://example.com/")).status).toBe(200);
  });
});
