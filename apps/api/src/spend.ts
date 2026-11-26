// The spending-limit stop (spec 5 and design doc 04). One gate, checked at case
// creation and before each metered model, OCR or decide call. The month's
// spend is computed in monthSpend alone, so a metering table can replace the
// case roll-up without touching callers.

import type { Tx } from "@preprocess/db/client";
import { cases } from "@preprocess/db/schema/cases";
import { usageRecords } from "@preprocess/db/schema/billing";
import { evalRuns } from "@preprocess/db/schema/evals";
import { organizationGuardrails } from "@preprocess/db/schema/guardrails";
import { and, eq, gte, isNull, sum } from "drizzle-orm";

import { ApiError } from "./cases.ts";

export type SpendVerdict = "ok" | "spending_limit_reached";

// The start of the calendar month in UTC that `now` falls in.
export const monthStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// Metered use of our hosted service this month, in micro-USD: the cost of the
// organization's cases and eval runs created this month, every deployment
// included, and the OCR API's calls, which have no case. A self-hosted
// install's own serving URLs never add cost.
export const monthSpendParts = async (tx: Tx, now = new Date()) => {
  const [caseRow] = await tx
    .select({ total: sum(cases.costMicroUsd) })
    .from(cases)
    .where(gte(cases.createdAt, monthStart(now)));
  const [evalRow] = await tx
    .select({ total: sum(evalRuns.costMicroUsd) })
    .from(evalRuns)
    .where(gte(evalRuns.createdAt, monthStart(now)));
  const [ocrRow] = await tx
    .select({ total: sum(usageRecords.quantity) })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.feature, "ocr"),
        isNull(usageRecords.caseId),
        gte(usageRecords.at, monthStart(now)),
      ),
    );
  return {
    cases: Number(caseRow?.total ?? 0),
    evals: Number(evalRow?.total ?? 0),
    ocr: Number(ocrRow?.total ?? 0),
  };
};

export const monthSpend = async (tx: Tx, now = new Date()) => {
  const parts = await monthSpendParts(tx, now);
  return parts.cases + parts.evals + parts.ocr;
};

export const spendingLimit = async (tx: Tx) => {
  const [row] = await tx
    .select({ limit: organizationGuardrails.spendingLimitMicroUsd })
    .from(organizationGuardrails);
  return row?.limit ?? null;
};

// Runs in the organization's transaction (RLS scopes both reads to it).
export const spendGate = async (
  tx: Tx,
  now = new Date(),
): Promise<SpendVerdict> => {
  const limit = await spendingLimit(tx);
  if (limit === null) return "ok";
  return (await monthSpend(tx, now)) >= limit ? "spending_limit_reached" : "ok";
};

export const refuseOverLimit = async (tx: Tx) => {
  if ((await spendGate(tx)) === "spending_limit_reached")
    throw new ApiError(
      402,
      "spending_limit_reached",
      "This organization has reached the monthly spending limit an Admin set.",
    );
};
