// Metering (spec 16a): what our cloud bills for, recorded in the transaction
// of the action that caused it and reported to the billing service later.
// Only our cloud meters; a self-hosted install records nothing (spec 16).

import type { Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { seatActivity, usageRecords } from "@preprocess/db/schema/billing";
import { runMode } from "@preprocess/runmode";
import { and, eq, inArray, sum } from "drizzle-orm";

import type { Env } from "./env.ts";

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
