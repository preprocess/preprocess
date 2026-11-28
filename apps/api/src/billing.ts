// Billing on our cloud (spec 16a): reporting metered usage to Autumn, and
// reading an organization's plan and balances back. Every function here is a
// no-op where autumn() is null: a self-hosted install, or a stage without
// AUTUMN_SECRET_KEY.

import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
import type { OrgId, SystemTx } from "@preprocess/db/client";
import { organization } from "@preprocess/db/schema/auth";
import { newId } from "@preprocess/db/ids";
import {
  freeCreditGrants,
  usageRecords,
  usageReports,
} from "@preprocess/db/schema/billing";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import {
  autumn,
  AutumnError,
  type Autumn,
  type AutumnCustomer,
} from "./autumn.ts";
import type { Env } from "./env.ts";
import { monthOf } from "./metering.ts";

const BATCH = 500;

// A credit is $0.01. The ledger records usage in micro-USD.
export const MICRO_USD_PER_CREDIT = 10_000;

// Storage is billed in GB-months; each day adds that day's share, counted in
// millionths of one.
const MICRO_GB_MONTHS_PER_GB_MONTH = 1_000_000;

// The billing service's feature for each ledger feature, and how many ledger
// units make one billed unit. Log bytes are not sent: they feed the daily
// storage figure.
const billedAs = {
  cases: { featureId: "cases", per: 1 },
  model_usage: { featureId: "model_usage_credits", per: MICRO_USD_PER_CREDIT },
  decide: { featureId: "decide_credits", per: MICRO_USD_PER_CREDIT },
  ocr: { featureId: "ocr_credits", per: MICRO_USD_PER_CREDIT },
  sandbox: { featureId: "sandbox_credits", per: MICRO_USD_PER_CREDIT },
  case_fees: { featureId: "case_fee_credits", per: MICRO_USD_PER_CREDIT },
} as const;

// The prepaid balance Free and Team pay a case's usage from (PRE-96). The id
// predates prepaid credits.
export const CREDITS = "model_credit";

// The add-on plan credits are bought through, at $0.01 each.
export const CREDITS_PLAN = "credits";

// Plan prices and allowances, as in autumn.config.ts. Free includes 3 seats,
// 1,000 cases a month and 5 GB; Team and Enterprise pay $16 an active seat
// and include 50 GB. Every plan's first 1,000 cases a month have no case fee.
// Storage past the allowance is $0.10 a GB-month, billed to the card. Internal
// pays nothing.
export const FREE_SEATS = 3;
export const FREE_CASES = 1_000;
export const FREE_STORAGE_GB = 5;
export const STORAGE_USD_PER_GB_MONTH = 0.1;
export const prices = (plan: CloudPlan["name"]) => ({
  seatUsd: plan === "team" || plan === "enterprise" ? 16 : 0,
  includedSeats: plan === "free" ? FREE_SEATS : 0,
  includedCases: FREE_CASES,
  includedStorageGb: plan === "free" ? FREE_STORAGE_GB : 50,
  storageUsdPerGbMonth: plan === "internal" ? 0 : STORAGE_USD_PER_GB_MONTH,
});

// The smallest purchase, by hand or by auto-reload: $10, so Stripe's fee is
// a small share of it. Credits never expire; refunds go through support.
export const MIN_TOP_UP_CREDITS = 1_000;

// Adds the next report of a feature: the remainder the last one carried plus
// these ledger units, sent as whole billed units with the rest carried on.
// Nothing is rounded up.
const addReport = async (
  tx: SystemTx,
  report: {
    id: string;
    organizationId: string;
    feature: string;
    units: number;
    per: number;
  },
) => {
  const [last] = await tx
    .select({ seq: usageReports.seq, remainder: usageReports.remainder })
    .from(usageReports)
    .where(
      and(
        eq(usageReports.organizationId, report.organizationId),
        eq(usageReports.feature, report.feature),
      ),
    )
    .orderBy(desc(usageReports.seq))
    .limit(1);
  const total = (last?.remainder ?? 0) + report.units;
  const quantity = Math.floor(total / report.per);
  await tx.insert(usageReports).values({
    id: report.id,
    organizationId: report.organizationId,
    feature: report.feature,
    seq: (last?.seq ?? 0) + 1,
    quantity,
    remainder: total - quantity * report.per,
  });
};

// Gathers the ledger's unreported rows into one report per organization and
// feature, then sends every unsent report.
// `only` limits it to one organization.
export const reportUsage = async (env: Env, only?: string) => {
  const billing = autumn(env);
  if (!billing) return;
  const unbundled = and(
    isNull(usageRecords.reportedAt),
    isNull(usageRecords.reportId),
    ne(usageRecords.feature, "log_bytes"),
    only ? eq(usageRecords.organizationId, only) : undefined,
  );
  const groups = await withoutOrg(env, "billing: unreported usage", (tx) =>
    tx
      .selectDistinct({
        organizationId: usageRecords.organizationId,
        feature: usageRecords.feature,
      })
      .from(usageRecords)
      .where(unbundled)
      .limit(BATCH),
  );
  for (const { organizationId, feature } of groups) {
    if (feature === "log_bytes") continue;
    try {
      await withoutOrg(env, "billing: bundle usage", async (tx) => {
        const rows = await tx
          .select({ id: usageRecords.id, quantity: usageRecords.quantity })
          .from(usageRecords)
          .where(
            and(
              eq(usageRecords.organizationId, organizationId),
              eq(usageRecords.feature, feature),
              unbundled,
            ),
          )
          .limit(BATCH * 10)
          .for("update");
        if (!rows.length) return;
        const id = newId("usageReport");
        await addReport(tx, {
          id,
          organizationId,
          feature: billedAs[feature].featureId,
          per: billedAs[feature].per,
          units: rows.reduce((total, row) => total + row.quantity, 0),
        });
        await tx
          .update(usageRecords)
          .set({ reportId: id })
          .where(
            inArray(
              usageRecords.id,
              rows.map((row) => row.id),
            ),
          );
      });
    } catch (error) {
      console.error("billing: bundle usage", organizationId, feature, error);
    }
  }
  const unsent = await sendReports(env, billing, only);
  if (only && unsent) throw new Error(`${unsent} usage reports were not sent`);
};

// Sends unsent reports, oldest first, each under its own id as the
// idempotency key, so a retry never counts twice. Returns how many are left
// unsent.
const sendReports = async (env: Env, billing: Autumn, only?: string) => {
  const reports = await withoutOrg(env, "billing: unsent reports", (tx) =>
    tx
      .select()
      .from(usageReports)
      .where(
        and(
          isNull(usageReports.reportedAt),
          only ? eq(usageReports.organizationId, only) : undefined,
        ),
      )
      .orderBy(asc(usageReports.at))
      .limit(BATCH),
  );
  const sent: string[] = [];
  const known = new Set<string>();
  for (const report of reports) {
    try {
      if (report.quantity > 0) {
        if (!known.has(report.organizationId)) {
          await billing.customer(report.organizationId);
          known.add(report.organizationId);
        }
        await billing.track({
          organizationId: report.organizationId,
          featureId: report.feature,
          value: report.quantity,
          at: report.at,
          idempotencyKey: report.id,
        });
      }
      sent.push(report.id);
    } catch (error) {
      console.error("billing: report usage", report.organizationId, error);
    }
  }
  if (sent.length)
    await withoutOrg(env, "billing: mark usage reported", async (tx) => {
      const now = new Date();
      await tx
        .update(usageReports)
        .set({ reportedAt: now })
        .where(inArray(usageReports.id, sent));
      await tx
        .update(usageRecords)
        .set({ reportedAt: now })
        .where(inArray(usageRecords.reportId, sent));
    });
  return reports.length - sent.length;
};

// People with a paid seat (spec 16a): members of the Developers group or of a
// group with operator access to an agent. Viewers, and Owners and Admins in
// no such group, are free.
const paidSeat = (org: string) => sql`
  exists (
    select 1 from group_members gm
    join groups g on g.id = gm.group_id
    where gm.organization_id = ${org} and gm.user_id = sa.user_id
      and (g.is_developers or exists (
        select 1 from agent_grants ag
        where ag.group_id = g.id and ag.access = 'operator'))
  )`;

// Active seats for a month (spec 16a): people who did paid-seat work in it and
// hold a paid seat when it closes. A person counts once.
export const activeSeats = async (tx: SystemTx, org: string, month: string) => {
  const [row] = (
    await tx.execute<{ seats: number }>(sql`
      select count(distinct sa.user_id)::int as seats
      from seat_activity sa
      where sa.organization_id = ${org} and sa.month = ${month}
        and ${paidSeat(org)}`)
  ).rows;
  return row?.seats ?? 0;
};

// Bytes each organization stores (spec 16a): documents, run capture and run
// logs. Agent bundles are not counted.
export const storedBytes = async (tx: SystemTx, org?: string) =>
  (
    await tx.execute<{ org: string; bytes: string }>(sql`
      select o.id as org,
        coalesce((select sum(size) from files f where f.organization_id = o.id), 0)
        + coalesce((select sum(capture_bytes) from cases c where c.organization_id = o.id), 0)
        + coalesce((select sum(quantity) from usage_records u
            where u.organization_id = o.id and u.feature = 'log_bytes'), 0)
        + coalesce((select sum(bytes) from sandbox_layers l
            where l.organization_id = o.id), 0)
          as bytes
      from organization o
      ${org ? sql`where o.id = ${org}` : sql``}`)
  ).rows.map((r) => ({ org: r.org, bytes: Number(r.bytes) }));

const daysIn = (day: Date) =>
  new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0),
  ).getUTCDate();

const track = async (
  billing: Autumn,
  usage: Parameters<Autumn["track"]>[0],
) => {
  try {
    await billing.customer(usage.organizationId);
    await billing.track(usage);
  } catch (error) {
    console.error("billing:", usage.idempotencyKey, error);
  }
};

// Once a day, after midnight UTC. Each day adds that day's share of a
// GB-month of storage. On the first of a month, the month that ended reports
// its active seats.
export const reportDaily = async (env: Env, now: Date) => {
  const billing = autumn(env);
  if (!billing) return;
  const yesterday = new Date(now.getTime() - 86_400_000);
  const day = yesterday.toISOString().slice(0, 10);
  const stored = await withoutOrg(env, "billing: storage", storedBytes);
  for (const { org, bytes } of stored) {
    if (bytes <= 0) continue;
    const id = `storage:${org}:${day}`;
    try {
      await withoutOrg(env, "billing: storage report", async (tx) => {
        const [done] = await tx
          .select({ id: usageReports.id })
          .from(usageReports)
          .where(eq(usageReports.id, id));
        if (done) return;
        await addReport(tx, {
          id,
          organizationId: org,
          feature: "storage_gb_months",
          per: MICRO_GB_MONTHS_PER_GB_MONTH,
          units: Math.floor(
            (bytes * MICRO_GB_MONTHS_PER_GB_MONTH) / 1e9 / daysIn(yesterday),
          ),
        });
      });
    } catch (error) {
      console.error("billing: storage report", org, error);
    }
  }
  await sendReports(env, billing);
  if (now.getUTCDate() !== 1) return;
  const month = monthOf(yesterday);
  const seats = await withoutOrg(env, "billing: active seats", async (tx) => {
    const orgs = await tx.select({ id: organization.id }).from(organization);
    const counts = [];
    for (const { id } of orgs)
      counts.push({ org: id, seats: await activeSeats(tx, id, month) });
    return counts;
  });
  for (const { org, seats: value } of seats)
    if (value > 0)
      await track(billing, {
        organizationId: org,
        featureId: "seats",
        value,
        at: now,
        idempotencyKey: `seats:${org}:${month}`,
      });
};

export type CloudPlan = {
  name: "free" | "team" | "enterprise" | "internal";
  // A plan change waiting for the end of the billing period.
  change: { plan: CloudPlan["name"]; at: Date | null } | null;
  features: Set<string>;
  seats: number | null;
  // Whether the organization has started a plan: at checkout, which takes a
  // card, or attached by plan() below.
  started: boolean;
  // When the payment still owed was due: the oldest open invoice of a past-due
  // subscription. Null when nothing is past due, or when the invoices weren't
  // read.
  pastDueSince: Date | null;
};

// A failed renewal leaves this long to update the card before new cases stop
// (Chip, 2026-11-27).
export const PAST_DUE_GRACE_DAYS = 7;

// Whether the grace for a failed payment has run out. Enterprise pays by
// invoice on terms arranged with us, and Internal pays nothing.
export const pastDueStop = (plan: CloudPlan, now = new Date()) =>
  plan.pastDueSince !== null &&
  plan.name !== "enterprise" &&
  plan.name !== "internal" &&
  now.getTime() - plan.pastDueSince.getTime() >=
    PAST_DUE_GRACE_DAYS * 86_400_000;

const PLANS = ["free", "team", "enterprise", "internal"] as const;

export const readPlan = (customer: AutumnCustomer): CloudPlan => {
  const active = customer.subscriptions.find(
    (s) =>
      (s.status === "active" || s.status === "trialing") &&
      (PLANS as readonly string[]).includes(s.plan_id),
  );
  const name = (active?.plan_id ?? "free") as CloudPlan["name"];
  const seats = customer.balances.seats;
  const scheduled = customer.subscriptions.find(
    (s) =>
      s.status === "scheduled" &&
      (PLANS as readonly string[]).includes(s.plan_id),
  );
  return {
    name,
    change: scheduled
      ? {
          plan: scheduled.plan_id as CloudPlan["name"],
          at: scheduled.started_at ? new Date(scheduled.started_at) : null,
        }
      : null,
    features: new Set(Object.keys(customer.flags ?? {})),
    seats: name === "free" && seats && !seats.unlimited ? seats.granted : null,
    started: Boolean(active),
    pastDueSince: active?.past_due ? oldestOpenInvoice(customer) : null,
  };
};

const oldestOpenInvoice = (customer: AutumnCustomer) => {
  const open = (customer.invoices ?? []).filter((i) => i.status === "open");
  return open.length > 0
    ? new Date(Math.min(...open.map((i) => i.created_at)))
    : null;
};

// A short cache per isolate: gates run on every case and model call.
const cached = new Map<string, { until: number; value: Promise<unknown> }>();
const remember = <T>(key: string, ms: number, load: () => Promise<T>) => {
  const hit = cached.get(key);
  if (hit && hit.until > Date.now()) return hit.value as Promise<T>;
  const value = load();
  cached.set(key, { until: Date.now() + ms, value });
  value.catch(() => cached.delete(key));
  return value;
};

// When cards became required (BILLING_REQUIRED_FROM), or null.
const requiredFrom = (env: Env) => {
  const at = env.BILLING_REQUIRED_FROM && new Date(env.BILLING_REQUIRED_FROM);
  return at && !Number.isNaN(at.getTime()) ? at : null;
};

const listed = (list: string | undefined, org: OrgId) =>
  (list ?? "")
    .split(",")
    .map((id) => id.trim())
    .includes(org);

export const isInternal = (env: Env, org: OrgId) =>
  listed(env.BILLING_INTERNAL_ORGS, org);

// Whether billing holds for an organization: for those BILLING_ENFORCED_ORGS
// names, always; for the rest, once BILLING_REQUIRED_FROM has passed.
const enforced = (env: Env, org: OrgId, now: Date) => {
  if (listed(env.BILLING_ENFORCED_ORGS, org)) return true;
  const from = requiredFrom(env);
  return from !== null && now >= from;
};

// The plan an organization without one is given without a card: internal for
// our own, and Free for every organization created before cards were
// required. Anyone else, and any organization billed early, starts one at
// checkout.
const planWithoutCard = async (env: Env, org: OrgId) => {
  if (isInternal(env, org)) return "internal";
  if (listed(env.BILLING_ENFORCED_ORGS, org)) return null;
  const from = requiredFrom(env);
  if (!from) return null;
  const created = await withoutOrg(env, "billing: organization age", (tx) =>
    tx
      .select({ createdAt: organization.createdAt })
      .from(organization)
      .where(eq(organization.id, org)),
  );
  return created[0] && created[0].createdAt < from ? "free" : null;
};

// Free's $5 (Chip, 2026-11-26: "One time $5"), granted by us at most once
// per organization and once per card (Captain), so moving between Team and
// Free, or deleting and recreating an organization on the same card, never
// grants it again. Free is attached without it (autumn.ts).
const FREE_CREDITS = 500;
const FREE_CREDITS_ID = "free_credit";

// Autumn grants Free's included credits on every attach, and perhaps again
// when a scheduled Free starts, whatever the attach removed. Any such grant
// on top of the $5 this organization already had, or to a card that had it
// elsewhere, is taken back; what was used from it stays owed. An
// organization that got its $5 from Free before PRE-96 keeps that one grant.
const takeBackFreeGrants = async (
  billing: Autumn,
  org: OrgId,
  customer: AutumnCustomer,
  keepOne: boolean,
) => {
  const grants =
    customer.balances[CREDITS]?.breakdown?.filter(
      (b) => b.plan_id === "free" && b.included_grant > 0,
    ) ?? [];
  for (const grant of keepOne ? grants.slice(1) : grants) {
    await billing.revoke(org, {
      featureId: CREDITS,
      id: grant.id,
      usage: grant.usage,
    });
    console.log("billing: took back a repeated Free grant", org, grant.id);
  }
};

const grantFreeCredits = async (
  billing: Autumn,
  env: Env,
  org: OrgId,
  customer: AutumnCustomer,
) => {
  const [done] = await withoutOrg(env, "billing: free credits", (tx) =>
    tx
      .select({ granted: freeCreditGrants.granted })
      .from(freeCreditGrants)
      .where(eq(freeCreditGrants.organizationId, org)),
  );
  const ours = Boolean(
    customer.balances[CREDITS]?.breakdown?.some(
      (b) => b.id === FREE_CREDITS_ID,
    ),
  );
  if (done) {
    await takeBackFreeGrants(billing, org, customer, done.granted && !ours);
    return;
  }
  // Before PRE-96, attaching Free carried the $5 itself.
  const had = Boolean(
    customer.balances[CREDITS]?.breakdown?.some(
      (b) =>
        b.id === FREE_CREDITS_ID ||
        (b.plan_id === "free" && b.included_grant > 0),
    ),
  );
  const card = had
    ? null
    : ((await billing.customer(org, undefined, ["payment_method"]))
        .payment_method?.card?.fingerprint ?? null);
  const claimed = await withoutOrg(env, "billing: claim free credits", (tx) =>
    tx
      .insert(freeCreditGrants)
      .values({ organizationId: org, cardFingerprint: card, granted: true })
      .onConflictDoNothing()
      .returning({ org: freeCreditGrants.organizationId }),
  );
  if (!claimed.length) {
    // The card had its $5 in another organization.
    await withoutOrg(env, "billing: refuse free credits", (tx) =>
      tx
        .insert(freeCreditGrants)
        .values({ organizationId: org, cardFingerprint: null, granted: false })
        .onConflictDoNothing(),
    );
    console.log("billing: free credits already used on this card", org);
    await takeBackFreeGrants(billing, org, customer, false);
    return;
  }
  if (had) {
    await takeBackFreeGrants(billing, org, customer, !ours);
    return;
  }
  try {
    await billing.grant(org, {
      featureId: CREDITS,
      credits: FREE_CREDITS,
      id: FREE_CREDITS_ID,
    });
  } catch (error) {
    if (!(error instanceof AutumnError && error.status === 409)) {
      await withoutOrg(env, "billing: release free credits", (tx) =>
        tx
          .delete(freeCreditGrants)
          .where(eq(freeCreditGrants.organizationId, org)),
      );
      throw error;
    }
  }
  await takeBackFreeGrants(billing, org, customer, false);
};

// After any move to Free, outside a request: grants or takes back the $5.
export const settleFreeCredits = async (env: Env, org: string) => {
  const billing = autumn(env);
  if (!billing) return;
  const customer = await billing.customer(org);
  const plan = readPlan(customer);
  if (plan.started && plan.name === "free")
    await grantFreeCredits(billing, env, orgId(org), customer);
};

const loadPlan = async (billing: Autumn, env: Env, org: OrgId) => {
  let customer = await billing.customer(org);
  if (!readPlan(customer).started) {
    const given = await planWithoutCard(env, org);
    if (given) {
      await billing.attach(org, { planId: given });
      console.log("billing: attached without a card", org, given);
      customer = await billing.customer(org);
    }
  }
  // A failed payment: read the invoices too, for when it was due.
  if (customer.subscriptions.some((s) => s.past_due))
    customer = await billing.customer(org, undefined, ["invoices"]);
  const current = readPlan(customer);
  if (current.started && current.name === "free")
    await grantFreeCredits(billing, env, org, customer);
  return current;
};

export const cloudPlan = async (env: Env, org: OrgId) => {
  const billing = autumn(env);
  if (!billing) return null;
  try {
    const plan = await remember(`plan:${org}`, 30_000, () =>
      loadPlan(billing, env, org),
    );
    // A plan not started yet may start at checkout any moment: read it again.
    if (!plan.started) cached.delete(`plan:${org}`);
    return plan;
  } catch (error) {
    // Fail open: an Autumn outage never stops the product.
    console.error("billing: plan", org, error);
    return null;
  }
};

// Whether an organization without a plan is refused: once billing holds for
// it.
export const planRequired = (
  env: Env,
  org: OrgId,
  started: boolean,
  now = new Date(),
) => !started && enforced(env, org, now);

// Whether the plan's seat limit holds: like the card, only once billing holds
// for the organization, and never for our own organizations.
export const seatLimitApplies = (env: Env, org: OrgId, now = new Date()) =>
  enforced(env, org, now) && !isInternal(env, org);

// Whether the organization may use a feature: once cards are required it
// needs a started plan (every plan, Free included, starts at checkout with a
// card), a payment past due stops it once its grace runs out, and Free caps
// its monthly cases. Where billing is off everything is allowed, and an
// Autumn outage fails open.
export const entitlement = async (
  env: Env,
  org: OrgId,
  featureId: string,
): Promise<"ok" | "plan_required" | "past_due" | "used_up"> => {
  const billing = autumn(env);
  if (!billing) return "ok";
  const plan = await cloudPlan(env, org);
  if (!plan) return "ok";
  if (!plan.started)
    return planRequired(env, org, plan.started) ? "plan_required" : "ok";
  if (pastDueStop(plan)) return "past_due";
  // Internal has no limits, and its customers keep the features they were
  // attached with, which a renamed feature leaves out.
  if (plan.name === "internal") return "ok";
  try {
    const allowed = await remember(
      `check:${org}:${featureId}`,
      15_000,
      async () => (await billing.check(org, featureId)).allowed,
    );
    return allowed ? "ok" : "used_up";
  } catch (error) {
    console.error("billing: check", org, featureId, error);
    return "ok";
  }
};

// The credit stop (PRE-96): Free and Team pay a case's usage from prepaid
// credits, and new cases and metered calls stop once none remain. Autumn
// keeps usage reported past the balance as debt and its check still allows
// it, so this reads the remaining balance itself. Enterprise draws on its
// commit and Internal has no limits. Where billing is off everything is
// allowed, and an Autumn outage fails open.
export const creditStop = async (
  env: Env,
  org: OrgId,
): Promise<"ok" | "plan_required" | "used_up"> => {
  const billing = autumn(env);
  if (!billing) return "ok";
  const plan = await cloudPlan(env, org);
  if (!plan) return "ok";
  if (!plan.started)
    return planRequired(env, org, plan.started) ? "plan_required" : "ok";
  if (plan.name !== "free" && plan.name !== "team") return "ok";
  try {
    const remaining = await remember(
      `credits:${org}`,
      15_000,
      async () =>
        (await billing.customer(org)).balances[CREDITS]?.remaining ?? 0,
    );
    return remaining > 0 ? "ok" : "used_up";
  } catch (error) {
    console.error("billing: credits", org, error);
    return "ok";
  }
};

// The prepaid balance as the Billing page shows it: credits left, and what
// was used past them, which the next purchase pays first.
export const readCredits = (customer: AutumnCustomer) => {
  const balance = customer.balances[CREDITS];
  if (!balance || balance.unlimited) return { remaining: 0, owed: 0 };
  return {
    remaining: balance.remaining,
    owed: Math.max(0, balance.usage - balance.granted),
  };
};

// The credits left, for analytics (analytics.ts): read through the same
// short cache as the credit stop. Null where billing is off or unread.
export const creditsRemaining = async (env: Env, org: OrgId) => {
  const billing = autumn(env);
  if (!billing) return null;
  try {
    return await remember(
      `credits:${org}`,
      15_000,
      async () =>
        (await billing.customer(org)).balances[CREDITS]?.remaining ?? 0,
    );
  } catch (error) {
    console.error("billing: credits", org, error);
    return null;
  }
};

// Deleting an organization ends Team (Captain): its usage and this month's
// seats are reported now, and Team is cancelled so nothing more accrues; the
// period's invoice bills them, with no refund, and credits left are
// forfeited. Any failure stops the deletion.
export const endBillingForDeletion = async (env: Env, org: string) => {
  const billing = autumn(env);
  if (!billing) return;
  const plan = readPlan(await billing.customer(org));
  if (!plan.started || plan.name !== "team") return;
  await reportUsage(env, org);
  const now = new Date();
  const month = monthOf(now);
  const seats = await withoutOrg(env, "billing: seats at deletion", (tx) =>
    activeSeats(tx, org, month),
  );
  if (seats > 0)
    await billing.track({
      organizationId: org,
      featureId: "seats",
      value: seats,
      at: now,
      idempotencyKey: `seats:${org}:${month}`,
    });
  await billing.end(org, "team");
  console.log("billing: ended Team for a deleted organization", org);
};

// The organization's name, for its Autumn customer.
export const organizationName = (env: Env, org: OrgId) =>
  withOrg(env, orgId(org), async (tx) => {
    const [row] = await tx
      .select({ name: organization.name })
      .from(organization);
    return row?.name;
  });
