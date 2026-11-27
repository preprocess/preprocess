// Seeded billing states for development (scenarios.ts, surface "billing"):
// Design's round-4 sample numbers, which add up exactly. Writes (top up,
// cancel, keep, auto-reload) stick in browser memory until reload.

import type { ScenarioState } from "../../scenarios/scenarios";
import type {
  Billing,
  BillingUsage,
  ChangePreview,
  Spending,
} from "./billing-types";

export type SeededBilling = Exclude<ScenarioState<"billing">, "live">;

const MONTH = "2026-11";
const DAYS = 26;
const WEIGHTS = [
  3.1, 2.4, 4.8, 5.2, 1.1, 0.8, 4.4, 5.9, 6.3, 4.1, 3.8, 1.2, 0.9, 5.1, 6.8,
  7.2, 5.5, 4.9, 1.4, 1.0, 5.8, 6.1, 7.4, 6.6, 3.9, 2.2,
];

// Cents per day in proportion to the weights, the remainder on the last day.
const daily = (totalUsd: number) => {
  const cents = Math.round(totalUsd * 100);
  const weight = WEIGHTS.reduce((a, b) => a + b, 0);
  const days = WEIGHTS.map((w) => Math.floor((cents * w) / weight));
  days[DAYS - 1] += cents - days.reduce((a, b) => a + b, 0);
  return days.map((c, i) => ({
    day: `${MONTH}-${String(i + 1).padStart(2, "0")}`,
    usd: c / 100,
  }));
};

const sum = (...values: number[]) =>
  Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;

const usage = (u: {
  seats: number;
  seatUsd: number;
  cases: number;
  fees: number;
  model: number;
  decide: number;
  ocr: number;
  sandbox: number;
  gbMonths: number;
  includedGb: number;
  storageUsd: number;
  free?: boolean;
  storageGb?: number;
}): BillingUsage => {
  const paid = sum(u.fees, u.model, u.decide, u.ocr, u.sandbox);
  return {
    month: MONTH,
    seats: {
      count: u.seats,
      includedCount: u.free ? 3 : 0,
      usd: u.seatUsd,
    },
    cases: { count: u.cases, includedCount: 1_000, usd: u.fees },
    modelUsageUsd: u.model,
    decideUsd: u.decide,
    ocrUsd: u.ocr,
    sandboxUsd: u.sandbox,
    storage: {
      gbMonths: u.gbMonths,
      includedGbMonths: u.includedGb,
      usd: u.storageUsd,
    },
    paidFromCreditsUsd: paid,
    billedAtMonthEndUsd: sum(u.seatUsd, u.storageUsd),
    daily: daily(paid),
    now: {
      seats: u.seats,
      seatLimit: u.free ? 3 : null,
      casesThisMonth: u.cases,
      caseLimit: u.free ? 1_000 : null,
      storageGb: u.storageGb ?? u.gbMonths,
      storageIncludedGb: u.includedGb,
    },
  };
};

const TEAM_USAGE = usage({
  seats: 7,
  seatUsd: 112,
  cases: 4_200,
  fees: 64,
  model: 23.84,
  decide: 2.94,
  ocr: 5.25,
  sandbox: 3.6,
  gbMonths: 62.4,
  includedGb: 50,
  storageUsd: 1.24,
});

const EMPTY_USAGE = usage({
  seats: 7,
  seatUsd: 112,
  cases: 5_200,
  fees: 84,
  model: 51.36,
  decide: 1.47,
  ocr: 8.4,
  sandbox: 4.77,
  gbMonths: 62.4,
  includedGb: 50,
  storageUsd: 1.24,
});

const LIMIT_USAGE = usage({
  seats: 12,
  seatUsd: 192,
  cases: 12_600,
  fees: 206,
  model: 268.29,
  decide: 4.41,
  ocr: 10.5,
  sandbox: 10.8,
  gbMonths: 84.1,
  includedGb: 50,
  storageUsd: 3.41,
});

const FREE_USAGE = usage({
  free: true,
  seats: 2,
  seatUsd: 0,
  cases: 640,
  fees: 0,
  model: 1.21,
  decide: 0.07,
  ocr: 0.21,
  sandbox: 0.33,
  gbMonths: 1.2,
  includedGb: 5,
  storageUsd: 0,
});

const FREE_EMPTY_USAGE = usage({
  free: true,
  seats: 3,
  seatUsd: 0,
  cases: 910,
  fees: 0,
  model: 3.92,
  decide: 0.18,
  ocr: 0.42,
  sandbox: 0.48,
  gbMonths: 2.4,
  includedGb: 5,
  storageUsd: 0,
});

const NO_CARD_USAGE = usage({
  free: true,
  seats: 1,
  seatUsd: 0,
  cases: 0,
  fees: 0,
  model: 0,
  decide: 0,
  ocr: 0,
  sandbox: 0,
  gbMonths: 0,
  includedGb: 5,
  storageUsd: 0,
});

const ENTERPRISE_USAGE = usage({
  seats: 48,
  seatUsd: 768,
  cases: 86_000,
  fees: 940,
  model: 1_284.5,
  decide: 22.05,
  ocr: 168,
  sandbox: 212.4,
  gbMonths: 412.6,
  includedGb: 50,
  storageUsd: 36.26,
});

const INTERNAL_USAGE = { ...TEAM_USAGE, billedAtMonthEndUsd: 0 };

const CARD = { brand: "visa", last4: "4242", expMonth: 8, expYear: 2028 };
const RELOAD_ON = {
  enabled: true,
  belowCredits: 2_500,
  addCredits: 10_000,
  monthlyLimitUsd: 500,
  failed: null,
  capReachedUntil: null,
};
const RELOAD_OFF = { ...RELOAD_ON, enabled: false };

const invoice = (month: number, totalUsd: number, status = "paid") => ({
  id: `in_seed_${month}`,
  at: new Date(Date.UTC(2026, month, 1)).toISOString(),
  totalUsd,
  status,
  url: `#invoice-${month}`,
});

const TEAM_INVOICES = [
  invoice(9, 214.8),
  invoice(8, 198.36),
  invoice(7, 176.12),
];

const base: Billing = {
  plan: "team",
  started: true,
  required: false,
  seats: null,
  change: null,
  switched: null,
  credits: { remaining: 10_037, owed: 0 },
  autoReload: RELOAD_ON,
  card: CARD,
  email: "billing@acme.example",
  pastDue: false,
  invoices: TEAM_INVOICES,
  commit: null,
};

const FREE: Billing = {
  ...base,
  plan: "free",
  seats: 3,
  credits: { remaining: 318, owed: 0 },
  autoReload: RELOAD_OFF,
  invoices: [invoice(9, 0)],
};

const END = "2026-12-01T00:00:00.000Z";

const seeds: Record<
  Exclude<SeededBilling, "loading">,
  { billing: Billing; usage: BillingUsage; limitUsd: number | null }
> = {
  free: { billing: FREE, usage: FREE_USAGE, limitUsd: null },
  "free-empty": {
    billing: { ...FREE, credits: { remaining: 0, owed: 0 } },
    usage: FREE_EMPTY_USAGE,
    limitUsd: null,
  },
  "no-card": {
    billing: {
      ...FREE,
      started: false,
      required: true,
      card: null,
      credits: { remaining: 500, owed: 0 },
      invoices: [],
    },
    usage: NO_CARD_USAGE,
    limitUsd: null,
  },
  team: { billing: base, usage: TEAM_USAGE, limitUsd: 500 },
  "team-small": { billing: base, usage: TEAM_USAGE, limitUsd: 500 },
  "team-low": {
    billing: {
      ...base,
      credits: { remaining: 412, owed: 0 },
      autoReload: RELOAD_OFF,
    },
    usage: TEAM_USAGE,
    limitUsd: 500,
  },
  "team-empty": {
    billing: {
      ...base,
      credits: { remaining: 0, owed: 0 },
      autoReload: RELOAD_OFF,
    },
    usage: EMPTY_USAGE,
    limitUsd: 500,
  },
  "team-negative": {
    billing: {
      ...base,
      credits: { remaining: 0, owed: 42 },
      autoReload: RELOAD_OFF,
    },
    usage: EMPTY_USAGE,
    limitUsd: 500,
  },
  "team-limit": {
    billing: { ...base, credits: { remaining: 31_255, owed: 0 } },
    usage: LIMIT_USAGE,
    limitUsd: 500,
  },
  "team-past-due": {
    billing: {
      ...base,
      pastDue: true,
      invoices: [invoice(9, 214.8, "open"), ...TEAM_INVOICES.slice(1)],
    },
    usage: TEAM_USAGE,
    limitUsd: 500,
  },
  "team-reload-failed": {
    billing: {
      ...base,
      credits: { remaining: 812, owed: 0 },
      autoReload: {
        ...RELOAD_ON,
        failed: { at: "2026-11-26T09:12:00.000Z", reason: "card_declined" },
      },
    },
    usage: TEAM_USAGE,
    limitUsd: 500,
  },
  "team-reload-cap": {
    billing: {
      ...base,
      credits: { remaining: 1_190, owed: 0 },
      autoReload: { ...RELOAD_ON, capReachedUntil: END },
    },
    usage: TEAM_USAGE,
    limitUsd: 500,
  },
  "team-ending": {
    billing: { ...base, change: { plan: "free", at: END } },
    usage: TEAM_USAGE,
    limitUsd: 500,
  },
  "team-switched": {
    billing: {
      ...base,
      switched: {
        people: 4,
        agents: [],
        at: "2026-11-01T00:00:00.000Z",
      },
    },
    usage: TEAM_USAGE,
    limitUsd: 500,
  },
  enterprise: {
    billing: {
      ...base,
      plan: "enterprise",
      credits: null,
      autoReload: null,
      invoices: [
        invoice(9, 3_212.44),
        invoice(8, 2_986.1),
        invoice(7, 2_640.32),
      ],
      commit: { usedUsd: 31_420, totalUsd: 50_000 },
    },
    usage: ENTERPRISE_USAGE,
    limitUsd: null,
  },
  internal: {
    billing: {
      ...base,
      plan: "internal",
      credits: null,
      autoReload: null,
      card: null,
      email: null,
      invoices: [],
    },
    usage: INTERNAL_USAGE,
    limitUsd: null,
  },
};

// Writes made in this browser session, by state.
const written = new Map<SeededBilling, Billing>();

export const seededBilling = (state: SeededBilling): Billing | undefined =>
  state === "loading"
    ? undefined
    : (written.get(state) ?? seeds[state].billing);

export const writeSeededBilling = (
  state: SeededBilling,
  change: (billing: Billing) => Billing,
) => {
  const current = seededBilling(state);
  if (current) written.set(state, change(current));
};

export const seededUsage = (state: SeededBilling): BillingUsage | undefined =>
  state === "loading" ? undefined : seeds[state].usage;

export const seededSpending = (state: SeededBilling): Spending | undefined => {
  if (state === "loading") return undefined;
  const { usage: u, limitUsd } = seeds[state];
  return {
    month: MONTH,
    spentUsd: u.paidFromCreditsUsd,
    limitUsd,
    reached: limitUsd !== null && u.paidFromCreditsUsd >= limitUsd,
  };
};

const PEOPLE = [
  "Dana Reyes",
  "Priya Shah",
  "Marcus Lee",
  "Elena Park",
  "Tom Becker",
  "Sara Kim",
  "Jonas Weber",
];

export const seededPreview = (state: SeededBilling): ChangePreview => ({
  at: END,
  items:
    state === "team-small"
      ? []
      : [
          {
            kind: "seats",
            limit: 3,
            people: PEOPLE.map((name, i) => ({
              userId: `user_seed_${i}`,
              name,
              email: `${name.split(" ")[0]?.toLowerCase()}@acme.example`,
              keeps: i < 3,
            })),
          },
          {
            kind: "agents",
            agents: [
              { id: "agent_seed_intake", slug: "intake-agent" },
              { id: "agent_seed_acme", slug: "acme-vendor-diligence" },
            ],
          },
          { kind: "storage", gb: 12.4, includedGb: 5, usdPerMonth: 0.74 },
          { kind: "cases", thisMonth: 4_200, limit: 1_000 },
        ],
});
