// This UTC month so far, as the Billing page's This month section shows it
// (PRE-94): usage from our own ledger, active seats, and storage from the
// daily storage reports. Every dollar figure is floored to the cent, so a
// charge is never rounded up, and the lines add up to their totals.
//
// Each ledger line also splits by agent (PRE-129), through the case or eval
// case a record was charged to. Usage with no case (the OCR API), or whose
// case is gone, has no agent. A line's floored total is shared out by largest
// remainder: every agent gets its own amount floored to the cent, and the
// cents flooring dropped go one each to the agents with the largest fractions,
// so the agents add up to the line exactly and none is off by a cent or more.

import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
import { agents } from "@preprocess/db/schema/access";
import { usageRecords } from "@preprocess/db/schema/billing";
import { cases } from "@preprocess/db/schema/cases";
import { evalRuns, evalSuites } from "@preprocess/db/schema/evals";
import { and, eq, gte, like, sql, sum } from "drizzle-orm";

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

// Shares a line's floored cents among its parts in micro-USD by largest
// remainder. The parts' fractions of a cent add up to less than one cent per
// part, so what flooring dropped never needs more than one cent per part.
const split = (totalCents: number, parts: number[]) => {
  const shares = parts.map(cents);
  let left = totalCents - shares.reduce((all, share) => all + share, 0);
  for (const i of parts
    .map((_, i) => i)
    .sort(
      (a, b) =>
        (parts[b]! % MICRO_USD_PER_CENT) - (parts[a]! % MICRO_USD_PER_CENT),
    )) {
    if (left <= 0) break;
    shares[i]! += 1;
    left -= 1;
  }
  return shares;
};

export const monthUsage = async (
  env: Env,
  org: string,
  plan: CloudPlan,
  now = new Date(),
) => {
  const price = prices(plan.name);
  const month = monthOf(now).slice(0, 7);
  const day = sql<string>`to_char(${usageRecords.at} at time zone 'UTC', 'YYYY-MM-DD')`;
  // A case's agent, or an eval case's (eval:<run>:<case>) through its suite.
  const agentId = sql<
    string | null
  >`coalesce(${cases.agentId}, ${evalSuites.agentId})`;
  const ledger = await withOrg(env, orgId(org), async (tx) => ({
    // One read for the lines, the days and the agents, so they agree.
    rows: await tx
      .select({
        feature: usageRecords.feature,
        day,
        agentId,
        slug: agents.slug,
        total: sum(usageRecords.quantity),
      })
      .from(usageRecords)
      .leftJoin(
        cases,
        and(
          eq(cases.organizationId, usageRecords.organizationId),
          eq(cases.id, usageRecords.caseId),
        ),
      )
      .leftJoin(
        evalRuns,
        and(
          like(usageRecords.caseId, "eval:%"),
          eq(evalRuns.organizationId, usageRecords.organizationId),
          eq(evalRuns.id, sql`split_part(${usageRecords.caseId}, ':', 2)`),
        ),
      )
      .leftJoin(
        evalSuites,
        and(
          eq(evalSuites.organizationId, evalRuns.organizationId),
          eq(evalSuites.id, evalRuns.suiteId),
        ),
      )
      .leftJoin(
        agents,
        and(
          eq(agents.organizationId, usageRecords.organizationId),
          eq(agents.id, agentId),
        ),
      )
      .where(
        and(
          eq(usageRecords.organizationId, org),
          gte(usageRecords.at, monthStart(now)),
        ),
      )
      .groupBy(usageRecords.feature, day, agentId, agents.slug),
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
  const buckets = [
    ...new Map(
      ledger.rows
        .filter(
          (r) => r.feature === "cases" || PAID_FROM_CREDITS.includes(r.feature),
        )
        .map((r) => [r.agentId, { agentId: r.agentId, slug: r.slug }]),
    ).values(),
  ].sort((a, b) =>
    a.slug === null ? 1 : b.slug === null ? -1 : a.slug.localeCompare(b.slug),
  );
  const shares = (feature: string, total: number) =>
    split(
      total,
      buckets.map((b) =>
        micro((r) => r.feature === feature && r.agentId === b.agentId),
      ),
    );
  const agentCases = buckets.map((b) =>
    micro((r) => r.feature === "cases" && r.agentId === b.agentId),
  );
  const agentFees = shares("case_fees", caseFees);
  const agentModel = shares("model_usage", model);
  const agentDecide = shares("decide", decide);
  const agentOcr = shares("ocr", ocr);
  const agentSandbox = shares("sandbox", sandbox);
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
    byAgent: buckets
      .map((b, i) => ({
        agentId: b.agentId,
        slug: b.slug,
        cases: agentCases[i]!,
        casesUsd: usd(agentFees[i]!),
        modelUsageUsd: usd(agentModel[i]!),
        decideUsd: usd(agentDecide[i]!),
        ocrUsd: usd(agentOcr[i]!),
        sandboxUsd: usd(agentSandbox[i]!),
      }))
      .filter(
        (a) =>
          a.cases ||
          a.casesUsd ||
          a.modelUsageUsd ||
          a.decideUsd ||
          a.ocrUsd ||
          a.sandboxUsd,
      ),
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
