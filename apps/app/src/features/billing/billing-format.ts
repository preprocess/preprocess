// Money, dates and plan copy for Billing (Design round 4, Writing's strings).

import type { Plan } from "./billing-types";

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$1,234.56", or "−$0.42" below zero. Callers pass amounts already floored. */
export const usd = (value: number) =>
  value < 0 ? `−${dollars.format(-value)}` : dollars.format(value);

/** Credits of $0.01 to dollars. */
export const creditsUsd = (credits: number) => credits / 100;

export const count = (value: number) => value.toLocaleString("en-US");

/** "December 1, 2026", in UTC like every billing date. */
export const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

/** "Dec 1". */
export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });

/** "November 2026" for "2026-11". */
export const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });

/** "Nov 1" for "2026-11-01". */
export const dayName = (day: string) => shortDate(`${day}T00:00:00Z`);

/** The 1st of the month after "2026-11", as "December 1, 2026". */
export const nextMonthStart = (month: string) => {
  const [year, m] = month.split("-").map(Number);
  return longDate(new Date(Date.UTC(year ?? 0, m ?? 0, 1)).toISOString());
};

export const PLAN_NAME: Record<Plan, string> = {
  free: "Free",
  team: "Team",
  enterprise: "Enterprise",
  internal: "Internal",
};

export const PLAN_SUMMARY: Record<Plan, string> = {
  free: "3 active seats, 1,000 cases a month, 5 GB storage included then $0.10/GB-month, and a one-time $5 starting credit. Card required.",
  team: "$16 per active seat a month, 1,000 free cases then 2¢/1¢/0.5¢ by volume, models at provider cost plus 5%, 50 GB storage then $0.10/GB-month.",
  enterprise:
    "Annual commit from $50,000 drawn down by seats and usage, plus audit export and support terms.",
  internal: "Internal organization. Usage isn't charged.",
};

export const CARD_BRAND: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
};

export const cardLabel = (card: { brand: string; last4: string }) =>
  `${CARD_BRAND[card.brand] ?? card.brand} ending in ${card.last4}`;

/** Whole dollars between min and max, with Writing's messages. */
export const wholeDollars =
  (min: number, max: number | null, minMessage: string, maxMessage?: string) =>
  (value: string): string | null => {
    const v = value.trim().replace(/^\$/, "").replaceAll(",", "");
    if (!/^\d+$/.test(v)) return "Enter a whole-dollar amount.";
    if (Number(v) < min) return minMessage;
    if (max !== null && Number(v) > max) return maxMessage ?? null;
    return null;
  };

export const dollarsOf = (value: string) =>
  Number(value.trim().replace(/^\$/, "").replaceAll(",", ""));

export const topUpAmount = wholeDollars(
  10,
  5_000,
  "Minimum top-up is $10.",
  "Maximum top-up is $5,000.",
);
