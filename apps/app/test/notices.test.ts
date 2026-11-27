// The sidebar notice stack's billing items (PRE-128 adds auto-reload's
// failed and cap-reached states), in the order and wording of the Billing
// handoff.

import { describe, expect, it } from "vitest";

import { buildNotices, type Billing } from "../src/features/notices/notices";

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
