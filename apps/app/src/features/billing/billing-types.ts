// The Billing API's shapes (apps/api/src/routes/billing.ts and spending.ts),
// as the settings page reads them.

export type Plan = "free" | "team" | "enterprise" | "internal";

/** Billing shows once the plan has started, or once billing holds and a plan must be started. */
export const billingShown = (billing: Pick<Billing, "started" | "required">) =>
  billing.started || billing.required;

export type AutoReload = {
  enabled: boolean;
  belowCredits: number;
  addCredits: number;
  monthlyLimitUsd: number | null;
};

// What auto-reload last ran into, shown to Owners and Admins: a failed charge
// nothing has resolved yet, and the monthly cap until it resumes.
export type AutoReloadState = {
  failed: { at: string; reason: "card_declined" | null } | null;
  capReachedUntil: string | null;
};

export type Invoice = {
  id: string;
  at: string;
  totalUsd: number;
  status: string;
  url: string | null;
};

export type Billing = {
  plan: Plan;
  started: boolean;
  required: boolean;
  seats: number | null;
  change: { plan: Plan; at: string | null } | null;
  switched: {
    people: number;
    agents: { id: string; slug: string }[];
    at: string | null;
  } | null;
  credits: { remaining: number; owed: number } | null;
  autoReload: (AutoReload & AutoReloadState) | null;
  card: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
  email: string | null;
  pastDue: boolean;
  invoices: Invoice[];
  commit: { usedUsd: number; totalUsd: number } | null;
};

/** One agent's share of this month's ledger lines; no agent for usage outside a case. */
export type AgentUsage = {
  agentId: string | null;
  slug: string | null;
  cases: number;
  casesUsd: number;
  modelUsageUsd: number;
  decideUsd: number;
  ocrUsd: number;
  sandboxUsd: number;
};

export type BillingUsage = {
  month: string;
  seats: { count: number; includedCount: number; usd: number };
  cases: { count: number; includedCount: number; usd: number };
  modelUsageUsd: number;
  decideUsd: number;
  ocrUsd: number;
  sandboxUsd: number;
  storage: { gbMonths: number; includedGbMonths: number; usd: number };
  byAgent: AgentUsage[];
  paidFromCreditsUsd: number;
  billedAtMonthEndUsd: number;
  daily: { day: string; usd: number }[];
  now: {
    seats: number;
    seatLimit: number | null;
    casesThisMonth: number;
    caseLimit: number | null;
    storageGb: number;
    storageIncludedGb: number;
  };
};

export type Spending = {
  month: string;
  spentUsd: number;
  limitUsd: number | null;
  reached: boolean;
};

export type ChangeItem =
  | {
      kind: "seats";
      limit: number;
      people: { userId: string; name: string; email: string; keeps: boolean }[];
    }
  | { kind: "agents"; agents: { id: string; slug: string }[] }
  | { kind: "storage"; gb: number; includedGb: number; usdPerMonth: number }
  | { kind: "cases"; thisMonth: number; limit: number };

export type ChangePreview = { at: string | null; items: ChangeItem[] };

// What a purchase needs next: nothing (the card on file was charged), the
// bank's confirmation, another card, or a first card, each on `url`.
export type PurchaseAction = "confirm_payment" | "card_declined" | "add_card";

export type Purchase = { url: string | null; action: PurchaseAction | null };
