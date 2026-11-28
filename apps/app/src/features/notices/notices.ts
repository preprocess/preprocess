import type { ScenarioState } from "../../scenarios/scenarios";
import {
  LICENSE_HREF,
  seededLicense,
  type License,
} from "../settings/license-seed";
import type { RemovedGroup } from "../settings/directory-sync-seed";
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
  /** A subscription payment failed and is still owed; false for Members. */
  pastDue: boolean;
  autoReload: {
    enabled: boolean;
    belowCredits: number;
    addCredits: number;
    monthlyLimitUsd: number | null;
    /** The last reload failed and nothing has resolved it; null for Members. */
    failed: { at: string; reason: "card_declined" | null } | null;
    /** The monthly cap was reached; reloads resume then. Null for Members. */
    capReachedUntil: string | null;
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

// One entry per billing notice for Owners and Admins, most urgent first.
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
  ({ pastDue }) =>
    pastDue
      ? {
          id: "past-due",
          level: "warning",
          title: "Payment failed",
          detail: "Update your card in Billing",
          href: BILLING_HREF,
        }
      : null,
  ({ autoReload }) =>
    autoReload?.failed
      ? {
          id: "reload-failed",
          level: "warning",
          title: "Auto-reload failed",
          detail:
            autoReload.failed.reason === "card_declined"
              ? "Card declined · Update in Billing"
              : "Update your card in Billing",
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
  ({ autoReload }) =>
    autoReload?.capReachedUntil
      ? {
          id: "reload-cap",
          level: "warning",
          title: "Auto-reload cap reached",
          detail: `Resumes ${monthDay(autoReload.capReachedUntil)} · Edit in Billing`,
          href: BILLING_HREF,
        }
      : null,
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

// Owners and Admins of a self-hosted install, when its license needs them.
const licenseNotice = (license: License): Notice | null => {
  switch (license.status) {
    case "grace":
      return {
        id: "license-grace",
        level: "warning",
        title: "License expired",
        detail: license.graceEndsAt
          ? `Grace ends ${monthDay(license.graceEndsAt)} · See License`
          : "See License",
        href: LICENSE_HREF,
      };
    case "expired":
      return {
        id: "license-expired",
        level: "error",
        title: "License expired",
        detail: "Features off · Renew in License",
        href: LICENSE_HREF,
      };
    case "invalid":
      return {
        id: "license-invalid",
        level: "warning",
        title: "License key isn't valid",
        detail: "Features off · Check in License",
        href: LICENSE_HREF,
      };
    case "active":
    case "none":
      return null;
  }
};

const DIRECTORY_SYNC_HREF = "/settings/organization/directory-sync";

/**
 * A dismissal id for a removed group. Dismissal ids allow only lowercase
 * letters, digits and hyphens, and group ids carry underscores.
 */
export const removedGroupNoticeId = (groupId: string) =>
  `group-removed-${groupId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`.slice(
    0,
    64,
  );

// Owners, Admins and the Developers group, when the identity provider removed
// a synced group; the API answers nobody else.
const removedGroupNotice = (group: RemovedGroup): Notice => ({
  id: removedGroupNoticeId(group.id),
  level: "warning",
  title: `${group.name} was removed`,
  detail: `Removed by IdP · ${group.agents} ${group.agents === 1 ? "agent names" : "agents name"} it`,
  href: DIRECTORY_SYNC_HREF,
  date: group.removedAt,
  dismissible: true,
});

const LEVELS: readonly NoticeLevel[] = ["error", "warning", "announcement"];

/**
 * The stack's notices in order: errors, then warnings, then announcements,
 * newest first within a level.
 */
export function buildNotices({
  billing,
  license = null,
  administers,
  dismissed,
  announcements = true,
  removedGroups = [],
}: {
  billing: Billing | null;
  /** Self-hosted only; null on our cloud and for Members. */
  license?: License | null;
  administers: boolean;
  dismissed: ReadonlySet<string>;
  announcements?: boolean;
  /** Synced groups the identity provider removed. */
  removedGroups?: readonly RemovedGroup[];
}): Notice[] {
  const fromBilling = billing?.started
    ? (administers ? MANAGER_NOTICES : MEMBER_NOTICES)
        .map((notice) => notice(billing))
        .filter((notice) => notice !== null)
    : [];
  const fromLicense =
    administers && license
      ? [licenseNotice(license)].filter((n) => n !== null)
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
  const fromDirectorySync = removedGroups
    .map(removedGroupNotice)
    .filter(({ id }) => !dismissed.has(id));
  const newest = (notice: Notice) => notice.date ?? "9999-12-31";
  return [
    ...fromBilling,
    ...fromLicense,
    ...fromDirectorySync,
    ...fromAnnouncements,
  ].sort(
    (a, b) =>
      LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) ||
      (newest(b) > newest(a) ? 1 : newest(b) < newest(a) ? -1 : 0),
  );
}

type Seeded = {
  billing: Billing | null;
  license: License | null;
  administers: boolean;
  announcements: boolean;
};

const seededBilling = (overrides: Partial<Billing>): Billing => ({
  plan: "team",
  started: true,
  change: null,
  credits: { remaining: 10_037, owed: 0 },
  pastDue: false,
  autoReload: {
    enabled: false,
    belowCredits: 2_500,
    addCredits: 10_000,
    monthlyLimitUsd: 500,
    failed: null,
    capReachedUntil: null,
  },
  ...overrides,
});

const RELOAD_ON: NonNullable<Billing["autoReload"]> = {
  enabled: true,
  belowCredits: 2_500,
  addCredits: 10_000,
  monthlyLimitUsd: 500,
  failed: null,
  capReachedUntil: null,
};

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
        license: null,
      };
    case "several":
      return {
        billing: seededBilling({
          credits: { remaining: 412, owed: 0 },
          change: teamEnding,
          pastDue: true,
          autoReload: {
            ...RELOAD_ON,
            failed: { at: "2026-11-26T09:12:00.000Z", reason: "card_declined" },
          },
        }),
        administers: true,
        announcements: true,
        license: null,
      };
    case "mixed":
      return {
        billing: seededBilling({
          credits: { remaining: 0, owed: 42 },
          change: teamEnding,
        }),
        administers: true,
        announcements: true,
        license: null,
      };
    case "reload-failed":
      return {
        billing: seededBilling({
          credits: { remaining: 812, owed: 0 },
          autoReload: {
            ...RELOAD_ON,
            failed: { at: "2026-11-26T09:12:00.000Z", reason: "card_declined" },
          },
        }),
        administers: true,
        announcements: false,
        license: null,
      };
    case "reload-cap":
      return {
        billing: seededBilling({
          credits: { remaining: 1_190, owed: 0 },
          autoReload: { ...RELOAD_ON, capReachedUntil: teamEnding.at },
        }),
        administers: true,
        announcements: false,
        license: null,
      };
    case "license-grace":
    case "license-expired":
    case "license-invalid":
      return {
        billing: null,
        license: seededLicense(
          state === "license-grace"
            ? "grace"
            : state === "license-expired"
              ? "expired"
              : "invalid",
        ),
        administers: true,
        announcements: false,
      };
    case "member":
      return {
        billing: seededBilling({ credits: { remaining: 0, owed: 0 } }),
        administers: false,
        announcements: true,
        license: null,
      };
    case "none":
      return {
        billing: null,
        license: null,
        administers: true,
        announcements: false,
      };
  }
}
