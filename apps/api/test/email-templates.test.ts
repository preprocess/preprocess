// The system emails escape every value a person typed in the HTML part and
// leave the plain-text part as written.

import { describe, expect, it } from "vitest";

import {
  invitationEmail,
  magicLinkEmail,
  taggedEmail,
  waitingEmail,
} from "../src/email-templates.ts";

const brand = { appUrl: "https://app.example.test" };
const caseData = {
  url: "https://app.example.test/cases/agt_1/case_1",
  settingsUrl: "https://app.example.test/settings/account",
  orgName: "Acme <script>",
  agent: "refunds",
  caseTitle: 'Order "48213" & <b>more</b>',
};

describe("system emails", () => {
  it("escape user input in HTML and keep it as written in text", () => {
    const email = taggedEmail(brand, {
      ...caseData,
      tagger: "The refunds agent",
      groupName: "Billing <img src=x>",
      message: "Approve <a href=evil>this</a>?",
    });
    expect(email.html).not.toMatch(
      /<script>|<img src=x>|<b>more|<a href=evil>/,
    );
    expect(email.html).toContain(
      "Order &quot;48213&quot; &amp; &lt;b&gt;more&lt;/b&gt;",
    );
    expect(email.text).toContain("Approve <a href=evil>this</a>?");
    expect(email.subject).toBe(
      'Billing <img src=x> was tagged on Order "48213" & <b>more</b> (refunds)',
    );
  });

  it("load images only from the install's own origin, with no tracking", () => {
    const html = invitationEmail(brand, {
      url: "https://app.example.test/invitations/inv_1",
      email: "jo@example.test",
      orgName: "Northwind",
      inviterName: "Maya Chen",
    }).html;
    const sources = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources)
      expect(src).toMatch(
        /^https:\/\/app\.example\.test\/brand\/email\/[\w-]+\.png$/,
      );
  });

  it("send both parts with the link in each", () => {
    const url =
      "https://app.example.test/api/auth/magic-link/verify?token=t&x=1";
    const email = magicLinkEmail(brand, { url });
    expect(email.text).toContain(url);
    expect(email.html).toContain(url.replace("&", "&amp;"));
  });

  it("leave out the reason when there is none, and clip long preheaders", () => {
    const none = waitingEmail(brand, {
      ...caseData,
      groupName: "Billing",
      reason: null,
    });
    expect(none.html).not.toContain(">Reason<");
    expect(none.text).not.toContain("Reason:");
    const long = taggedEmail(brand, {
      ...caseData,
      tagger: "Someone",
      groupName: "Billing",
      message: "x".repeat(300),
    });
    const preheader = /mso-hide:all[^>]*>([^&]*)&/.exec(long.html)?.[1];
    expect(preheader).toBe(`${"x".repeat(99)}…`);
  });
});
