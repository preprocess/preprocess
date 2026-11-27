import type { ScenarioState } from "../../scenarios/scenarios";
import { ANNOUNCEMENTS } from "./announcements";

export type NoticeLevel = "error" | "warning" | "announcement";

export type Notice = {
  id: string;
  level: NoticeLevel;
  title: string;
  detail: string;
  /** Where the card links; none for read-only notices. */
  href?: string;
  /** When it was posted, for newest-first within a level. Billing notices
   *  describe the state right now, so they have none and sort first. */
  date?: string;
  dismissible?: boolean;
};

/** The fields of GET /v1/orgs/{org}/billing the notices read. */
export type Billing = {
  plan: "free" | "team" | "enterprise" | "internal";
  started: boolean;
  change: { plan: Billing["plan"]; at: string | null } | null;
  /** Credits of $0.01; null on plans without prepaid credits. */
  credits: { remaining: number; owed: number } | null;
  autoReload: {
    enabled: boolean;
    belowCredits: number;
    addCredits: number;
    monthlyLimitUsd: number | null;
  } | null;
};

const BILLING_HREF = "/settings/organization/billing";

// Low balance with auto-reload off: under $5.
const LOW_CREDITS = 500;

const dollars = (credits: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    credits / 100,
  );

const monthDay = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));

const creditStopped = (billing: Billing) =>
  (billing.plan === "free" || billing.plan === "team") &&
  billing.credits !== null &&
  billing.credits.remaining <= 0;

type BillingNotice = (billing: Billing) => Notice | null;

// One entry per billing notice for Owners and Admins, most urgent first. Past
// due, reload failed and reload cap join here once the billing read carries
// them.
const MANAGER_NOTICES: readonly BillingNotice[] = [
  (billing) =>
    creditStopped(billing)
      ? {
          id: "credit-stop",
          level: "error",
          title: "Credit balance is empty",
          detail: "Cases paused · Add credits in Billing",
          href: BILLING_HREF,
        }
      : null,
  ({ credits, autoReload }) => {
    if (!credits || credits.remaining <= 0) return null;
    const below = autoReload?.enabled ? autoReload.belowCredits : LOW_CREDITS;
    return credits.remaining < below
      ? {
          id: "low-balance",
          level: "warning",
          title: "Low credit balance",
          detail: `${dollars(credits.remaining)} left · Top up in Billing`,
          href: BILLING_HREF,
        }
      : null;
  },
  ({ change }) =>
    change?.plan === "free" && change.at
      ? {
          id: "team-ending",
          level: "warning",
          title: `Team ends ${monthDay(change.at)}`,
          detail: "Review changes or keep Team",
          href: BILLING_HREF,
        }
      : null,
];

// Members see only what stops their work, read-only.
const MEMBER_NOTICES: readonly BillingNotice[] = [
  (billing) =>
    creditStopped(billing)
      ? {
          id: "credit-stop",
          level: "error",
          title: "Cases are paused",
          detail: "Credits ran out · Ask an Owner",
        }
      : null,
];

const LEVELS: readonly NoticeLevel[] = ["error", "warning", "announcement"];

/**
 * The stack's notices in order: errors, then warnings, then announcements,
 * newest first within a level.
 */
export function buildNotices({
  billing,
  administers,
  dismissed,
  announcements = true,
}: {
  billing: Billing | null;
  administers: boolean;
  dismissed: ReadonlySet<string>;
  announcements?: boolean;
}): Notice[] {
  const fromBilling = billing?.started
    ? (administers ? MANAGER_NOTICES : MEMBER_NOTICES)
        .map((notice) => notice(billing))
        .filter((notice) => notice !== null)
    : [];
  const fromAnnouncements = announcements
    ? ANNOUNCEMENTS.filter(({ id }) => !dismissed.has(id)).map(
        ({ id, title, detail, href, date }): Notice => ({
          id,
          level: "announcement",
          title,
          detail,
          href,
          date,
          dismissible: true,
        }),
      )
    : [];
  const newest = (notice: Notice) => notice.date ?? "9999-12-31";
  return [...fromBilling, ...fromAnnouncements].sort(
    (a, b) =>
      LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) ||
      (newest(b) > newest(a) ? 1 : newest(b) < newest(a) ? -1 : 0),
  );
}

type Seeded = {
  billing: Billing | null;
  administers: boolean;
  announcements: boolean;
};

const seededBilling = (overrides: Partial<Billing>): Billing => ({
  plan: "team",
  started: true,
  change: null,
  credits: { remaining: 10_037, owed: 0 },
  autoReload: {
    enabled: false,
    belowCredits: 2_500,
    addCredits: 10_000,
    monthlyLimitUsd: 500,
  },
  ...overrides,
});

const teamEnding = { plan: "free" as const, at: "2026-12-01T00:00:00.000Z" };

/** Development states of the stack; null for "live", which reads the API. */
export function seededNotices(state: ScenarioState<"notices">): Seeded | null {
  switch (state) {
    case "live":
      return null;
    case "one":
      return {
        billing: seededBilling({
          plan: "free",
          credits: { remaining: 0, owed: 0 },
        }),
        administers: true,
        announcements: false,
      };
    case "several":
      return {
        billing: seededBilling({
          credits: { remaining: 412, owed: 0 },
          change: teamEnding,
        }),
        administers: true,
        announcements: true,
      };
    case "mixed":
      return {
        billing: seededBilling({
          credits: { remaining: 0, owed: 42 },
          change: teamEnding,
        }),
        administers: true,
        announcements: true,
      };
    case "member":
      return {
        billing: seededBilling({ credits: { remaining: 0, owed: 0 } }),
        administers: false,
        announcements: true,
      };
    case "none":
      return { billing: null, administers: true, announcements: false };
  }
}
