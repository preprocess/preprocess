// This UTC month so far, as the Billing page's This month section shows it
// (PRE-94): usage from our own ledger, active seats, and storage from the
// daily storage reports. Every dollar figure is floored to the cent, so a
// charge is never rounded up, and the lines add up to their totals.

import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
import { usageRecords } from "@preprocess/db/schema/billing";
import { and, eq, gte, sql, sum } from "drizzle-orm";

import { activeSeats, prices, storedBytes, type CloudPlan } from "./billing.ts";
import type { Env } from "./env.ts";
import { monthOf } from "./metering.ts";
import { countSeats } from "./seats.ts";
import { monthStart } from "./spend.ts";

const MICRO_USD_PER_CENT = 10_000;
const MICRO_GB_MONTHS_PER_GB_MONTH = 1_000_000;

// The ledger features prepaid credits pay for.
const PAID_FROM_CREDITS: readonly string[] = [
  "model_usage",
  "decide",
  "ocr",
  "sandbox",
  "case_fees",
];

const usd = (cents: number) => cents / 100;
const cents = (microUsd: number) => Math.floor(microUsd / MICRO_USD_PER_CENT);

export const monthUsage = async (
  env: Env,
  org: string,
  plan: CloudPlan,
  now = new Date(),
) => {
  const price = prices(plan.name);
  const month = monthOf(now).slice(0, 7);
  const day = sql<string>`to_char(${usageRecords.at} at time zone 'UTC', 'YYYY-MM-DD')`;
  const ledger = await withOrg(env, orgId(org), async (tx) => ({
    rows: await tx
      .select({
        feature: usageRecords.feature,
        day,
        total: sum(usageRecords.quantity),
      })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.organizationId, org),
          gte(usageRecords.at, monthStart(now)),
        ),
      )
      .groupBy(usageRecords.feature, day),
    seatsNow: await countSeats(tx),
  }));
  const stored = await withoutOrg(env, "billing: month usage", async (tx) => {
    // Each daily report adds its day's share: its whole units and what it
    // left in the running remainder, less what it took from it.
    const prefix = `storage:${org}:${month}-`;
    const [storage] = (
      await tx.execute<{ units: string | null }>(sql`
        select sum(units) as units from (
          select id, quantity * ${MICRO_GB_MONTHS_PER_GB_MONTH} + remainder
            - coalesce(lag(remainder) over (order by seq), 0) as units
          from usage_reports
          where organization_id = ${org} and feature = 'storage_gb_months'
        ) r
        where left(id, ${prefix.length}) = ${prefix}`)
    ).rows;
    const [current] = await storedBytes(tx, org);
    return {
      seats: await activeSeats(tx, org, monthOf(now)),
      microGbMonths: Number(storage?.units ?? 0),
      bytes: current?.bytes ?? 0,
    };
  });

  const micro = (match: (row: (typeof ledger.rows)[number]) => boolean) =>
    ledger.rows
      .filter(match)
      .reduce((all, row) => all + Number(row.total ?? 0), 0);
  const line = (feature: string) => cents(micro((r) => r.feature === feature));
  const casesCount = micro((r) => r.feature === "cases");
  const caseFees = line("case_fees");
  const model = line("model_usage");
  const decide = line("decide");
  const ocr = line("ocr");
  const sandbox = line("sandbox");
  const seatCents = stored.seats * price.seatUsd * 100;
  const overMicroGbMonths = Math.max(
    0,
    stored.microGbMonths -
      price.includedStorageGb * MICRO_GB_MONTHS_PER_GB_MONTH,
  );
  const storageCents = Math.floor(
    (overMicroGbMonths * Math.round(price.storageUsdPerGbMonth * 100)) /
      MICRO_GB_MONTHS_PER_GB_MONTH,
  );

  return {
    month,
    seats: {
      count: stored.seats,
      includedCount: price.includedSeats,
      usd: usd(seatCents),
    },
    cases: {
      count: casesCount,
      includedCount: price.includedCases,
      usd: usd(caseFees),
    },
    modelUsageUsd: usd(model),
    decideUsd: usd(decide),
    ocrUsd: usd(ocr),
    sandboxUsd: usd(sandbox),
    storage: {
      gbMonths: stored.microGbMonths / MICRO_GB_MONTHS_PER_GB_MONTH,
      includedGbMonths: price.includedStorageGb,
      usd: usd(storageCents),
    },
    paidFromCreditsUsd: usd(model + decide + ocr + sandbox + caseFees),
    billedAtMonthEndUsd: usd(seatCents + storageCents),
    daily: Array.from({ length: now.getUTCDate() }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, "0")}`;
      return {
        day: date,
        usd: usd(
          cents(
            micro(
              (r) => r.day === date && PAID_FROM_CREDITS.includes(r.feature),
            ),
          ),
        ),
      };
    }),
    now: {
      seats: ledger.seatsNow,
      seatLimit: plan.seats,
      casesThisMonth: casesCount,
      caseLimit: plan.name === "free" ? price.includedCases : null,
      storageGb: Math.floor(stored.bytes / 1e7) / 100,
      storageIncludedGb: price.includedStorageGb,
    },
  };
};
