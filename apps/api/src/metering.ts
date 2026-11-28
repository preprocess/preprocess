// Metering (spec 16a): what our cloud bills for, recorded in the transaction
// of the action that caused it and reported to the billing service later.
// Only our cloud meters; a self-hosted install records nothing (spec 16).

import type { Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { seatActivity, usageRecords } from "@preprocess/db/schema/billing";
import { runMode } from "@preprocess/runmode";
import { and, count, eq, gte, inArray, sum } from "drizzle-orm";

import type { Env } from "./env.ts";

// The model charge is what the runtime priced each response at
// (apps/runtime/src/models.ts): a call through our providers or Workers AI at
// the provider's price plus 5%, and a call to an organization's own endpoint
// (an org:<slug> model or an override it registered) at zero (design doc 10).
// Case fees, decide and OCR are metered as usual either way.
export type Charges = { model: number; decide: number; ocr: number };

const chargeFeature = {
  model: "model_usage",
  decide: "decide",
  ocr: "ocr",
} as const;

const metered = (env: Pick<Env, "PREPROCESS_REGION">) =>
  runMode(env).kind === "cloud";

export const meter = async (
  tx: Tx,
  env: Pick<Env, "PREPROCESS_REGION">,
  usage: {
    organizationId: string;
    feature: (typeof usageRecords.$inferInsert)["feature"];
    quantity: number;
    caseId?: string | null;
  },
) => {
  if (!metered(env) || usage.quantity <= 0) return;
  await tx.insert(usageRecords).values({
    id: newId("usageRecord"),
    ...usage,
    caseId: usage.caseId ?? null,
  });
};

// A case reports its running total by kind; what was not metered yet is new.
// Totals only grow, so a late or repeated report records nothing.
export const meterCharges = async (
  tx: Tx,
  env: Pick<Env, "PREPROCESS_REGION">,
  organizationId: string,
  caseId: string,
  charges: Charges,
) => {
  if (!metered(env)) return;
  const features = Object.values(chargeFeature);
  const rows = await tx
    .select({
      feature: usageRecords.feature,
      total: sum(usageRecords.quantity),
    })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.caseId, caseId),
        inArray(usageRecords.feature, features),
      ),
    )
    .groupBy(usageRecords.feature);
  const known = new Map(rows.map((r) => [r.feature, Number(r.total ?? 0)]));
  for (const [kind, feature] of Object.entries(chargeFeature))
    await meter(tx, env, {
      organizationId,
      feature,
      quantity: charges[kind as keyof Charges] - (known.get(feature) ?? 0),
      caseId,
    });
};

// A case's fee by its place in the organization's month (spec 16a): the
// first 1,000 are free, then $0.02 each up to 10,000, $0.01 up to 100,000 and
// $0.005 after, in micro-USD. Fees are paid in credits like other usage.
export const caseFeeMicroUsd = (nth: number) =>
  nth <= 1_000 ? 0 : nth <= 10_000 ? 20_000 : nth <= 100_000 ? 10_000 : 5_000;

// Meters a new case's fee, once its own case record is in the ledger.
export const meterCaseFee = async (
  tx: Tx,
  env: Pick<Env, "PREPROCESS_REGION">,
  organizationId: string,
  caseId: string,
  now = new Date(),
) => {
  if (!metered(env)) return;
  const [row] = await tx
    .select({ cases: count() })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.organizationId, organizationId),
        eq(usageRecords.feature, "cases"),
        gte(
          usageRecords.at,
          new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        ),
      ),
    );
  await meter(tx, env, {
    organizationId,
    feature: "case_fees",
    quantity: caseFeeMicroUsd(row?.cases ?? 0),
    caseId,
  });
};

// The first day of the UTC month `at` falls in, as Postgres stores a date.
export const monthOf = (at: Date) =>
  `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-01`;

// A person did paid-seat work this month. Whether it bills is decided when
// the month closes, by the groups they are in then.
export const markSeat = async (
  tx: Tx,
  env: Pick<Env, "PREPROCESS_REGION">,
  seat: {
    organizationId: string;
    userId: string;
    role: "operator" | "developer";
  },
  at = new Date(),
) => {
  if (!metered(env)) return;
  await tx
    .insert(seatActivity)
    .values({ ...seat, month: monthOf(at) })
    .onConflictDoNothing();
};
