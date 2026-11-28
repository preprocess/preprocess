// The sidebar notice stack's billing items (PRE-128 adds auto-reload's
// failed and cap-reached states), in the order and wording of the Billing
// handoff.

import { describe, expect, it } from "vitest";

import {
  buildNotices,
  removedGroupNoticeId,
  type Billing,
} from "../src/features/notices/notices";
import { seededLicense } from "../src/features/settings/license-seed";

const RELOAD = {
  enabled: true,
  belowCredits: 2_500,
  addCredits: 10_000,
  monthlyLimitUsd: 500,
  failed: null,
  capReachedUntil: null,
};

const billing = (overrides: Partial<Billing> = {}): Billing => ({
  plan: "team",
  started: true,
  change: null,
  credits: { remaining: 10_037, owed: 0 },
  pastDue: false,
  autoReload: RELOAD,
  ...overrides,
});

const notices = (b: Billing, administers = true) =>
  buildNotices({
    billing: b,
    administers,
    dismissed: new Set(),
    announcements: false,
  });

const DECLINED = {
  at: "2026-11-26T09:12:00.000Z",
  reason: "card_declined" as const,
};

describe("auto-reload notices", () => {
  it("warns Owners and Admins that a declined reload failed, linking to Billing", () => {
    expect(
      notices(billing({ autoReload: { ...RELOAD, failed: DECLINED } })),
    ).toEqual([
      {
        id: "reload-failed",
        level: "warning",
        title: "Auto-reload failed",
        detail: "Card declined · Update in Billing",
        href: "/settings/organization/billing",
      },
    ]);
  });

  it("doesn't say the card was declined when the processor gave no reason", () => {
    const [notice] = notices(
      billing({
        autoReload: { ...RELOAD, failed: { ...DECLINED, reason: null } },
      }),
    );
    expect(notice).toMatchObject({
      id: "reload-failed",
      detail: "Update your card in Billing",
    });
  });

  it("says when a capped auto-reload resumes", () => {
    expect(
      notices(
        billing({
          autoReload: {
            ...RELOAD,
            capReachedUntil: "2026-12-01T00:00:00.000Z",
          },
        }),
      ),
    ).toEqual([
      {
        id: "reload-cap",
        level: "warning",
        title: "Auto-reload cap reached",
        detail: "Resumes Dec 1 · Edit in Billing",
        href: "/settings/organization/billing",
      },
    ]);
  });

  it("orders them among the other warnings, after the empty balance error", () => {
    const ids = notices(
      billing({
        credits: { remaining: 412, owed: 0 },
        pastDue: true,
        change: { plan: "free", at: "2026-12-01T00:00:00.000Z" },
        autoReload: {
          ...RELOAD,
          failed: DECLINED,
          capReachedUntil: "2026-12-01T00:00:00.000Z",
        },
      }),
    ).map((n) => n.id);
    expect(ids).toEqual([
      "past-due",
      "reload-failed",
      "low-balance",
      "reload-cap",
      "team-ending",
    ]);
    expect(
      notices(
        billing({
          credits: { remaining: 0, owed: 0 },
          autoReload: { ...RELOAD, failed: DECLINED },
        }),
      ).map((n) => n.id),
    ).toEqual(["credit-stop", "reload-failed"]);
  });

  it("shows Members neither", () => {
    expect(
      notices(
        billing({
          autoReload: {
            ...RELOAD,
            failed: DECLINED,
            capReachedUntil: "2026-12-01T00:00:00.000Z",
          },
        }),
        false,
      ),
    ).toEqual([]);
  });
});

describe("license notices", () => {
  const withLicense = (
    state: "active" | "grace" | "expired" | "invalid" | "none",
    administers = true,
  ) =>
    buildNotices({
      billing: null,
      license: seededLicense(state),
      administers,
      dismissed: new Set(),
      announcements: false,
    });

  it("warns Owners and Admins in grace with the grace end, linking to License", () => {
    expect(withLicense("grace")).toEqual([
      {
        id: "license-grace",
        level: "warning",
        title: "License expired",
        detail: "Grace ends Dec 15 · See License",
        href: "/settings/organization/license",
      },
    ]);
  });

  it("says paid features are off past grace and for an invalid key", () => {
    expect(withLicense("expired")).toMatchObject([
      {
        id: "license-expired",
        level: "error",
        detail: "Features off · Renew in License",
      },
    ]);
    expect(withLicense("invalid")).toMatchObject([
      { id: "license-invalid", level: "warning" },
    ]);
  });

  it("shows nothing for an active key, no key, or to Members", () => {
    expect(withLicense("active")).toEqual([]);
    expect(withLicense("none")).toEqual([]);
    expect(withLicense("grace", false)).toEqual([]);
    expect(withLicense("expired", false)).toEqual([]);
  });
});

describe("removed group notices", () => {
  const contractors = {
    id: "grp_01m8_contractors",
    slug: "contractors",
    name: "Contractors",
    removedAt: "2026-11-27T15:10:00.000Z",
    agents: 2,
  };
  const withGroups = (
    removedGroups: (typeof contractors)[],
    dismissed: string[] = [],
  ) =>
    buildNotices({
      billing: null,
      administers: false,
      dismissed: new Set(dismissed),
      announcements: false,
      removedGroups,
    });

  it("warns that the identity provider removed a group, linking to Directory sync", () => {
    expect(withGroups([contractors])).toEqual([
      {
        id: "group-removed-grp-01m8-contractors",
        level: "warning",
        title: "Contractors was removed",
        detail: "Removed from directory · 2 agents name it",
        href: "/settings/organization/directory-sync",
        date: contractors.removedAt,
        dismissible: true,
      },
    ]);
    expect(withGroups([{ ...contractors, agents: 1 }])[0]?.detail).toBe(
      "Removed from directory · 1 agent names it",
    );
  });

  it("uses a dismissal id the API accepts and hides a dismissed group", () => {
    const id = removedGroupNoticeId("grp_" + "X".repeat(80));
    expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
    expect(
      withGroups([contractors], [removedGroupNoticeId(contractors.id)]),
    ).toEqual([]);
  });
});
