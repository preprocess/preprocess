// The system emails escape every value a person typed in the HTML part and
// leave the plain-text part as written.

import { describe, expect, it } from "vitest";

import { emailBrand } from "../src/email.ts";
import type { Env } from "../src/env.ts";
import {
  assignedEmail,
  invitationEmail,
  magicLinkEmail,
  taggedEmail,
  waitingEmail,
  webhookDisabledEmail,
} from "../src/email-templates.ts";
import { testEnv } from "./helpers.ts";

const brand = { appUrl: "https://app.example.test", selfHosted: false };
const selfHosted = { ...brand, selfHosted: true };
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

  it("name Preprocess in footers on our cloud only", () => {
    const webhook = {
      url: "https://app.example.test/settings/organization/api-keys",
      endpointUrl: "https://hooks.example.test",
      orgName: "Northwind",
      days: 3,
    };
    const cloud = [
      assignedEmail(brand, caseData),
      webhookDisabledEmail(brand, webhook),
    ];
    const own = [
      assignedEmail(selfHosted, caseData),
      webhookDisabledEmail(selfHosted, webhook),
    ];
    expect(cloud[0]!.text).toContain(
      "Sent for Acme <script> on Preprocess. Turn",
    );
    expect(cloud[1]!.html).toContain(
      "owners and admins of Northwind on Preprocess.",
    );
    expect(own[0]!.text).toContain("Sent for Acme <script>. Turn");
    expect(own[0]!.html).toContain(
      "Sent for Acme &lt;script&gt;. You can turn",
    );
    expect(own[1]!.text).toContain("owners and admins of Northwind.\n");
    for (const email of own) {
      expect(email.html).not.toContain("on Preprocess.");
      expect(email.text).not.toContain("on Preprocess.");
    }
  });

  it("read self-hosting from the run mode", () => {
    expect(emailBrand(testEnv()).selfHosted).toBe(false);
    expect(
      emailBrand(
        testEnv({ PREPROCESS_REGION: undefined } as unknown as Partial<Env>),
      ).selfHosted,
    ).toBe(true);
  });

  it("state the disable period it is given", () => {
    const email = webhookDisabledEmail(brand, {
      url: "https://app.example.test/settings/organization/api-keys",
      endpointUrl: "https://hooks.example.test",
      orgName: "Northwind",
      days: 5,
    });
    expect(email.text).toContain("failed for 5 days, so");
    expect(email.html).toContain("failed for 5 days, so");
  });
});
