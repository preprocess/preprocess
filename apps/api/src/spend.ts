// The spending-limit stop (spec 5 and design doc 04). One gate, checked at case
// creation and before each metered model, OCR or decide call. The month's
// spend is computed in monthSpend alone, so a metering table can replace the
// case roll-up without touching callers.

import type { Tx } from "@preprocess/db/client";
import { cases } from "@preprocess/db/schema/cases";
import { organizationGuardrails } from "@preprocess/db/schema/guardrails";
import { gte, sum } from "drizzle-orm";

import { ApiError } from "./cases.ts";

export type SpendVerdict = "ok" | "spending_limit_reached";

// The start of the calendar month in UTC that `now` falls in.
export const monthStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// Metered use of our hosted service this month, in micro-USD: the cost of the
// organization's cases created this month, every deployment included. A
// self-hosted install's own serving URLs never add cost to a case.
export const monthSpend = async (tx: Tx, now = new Date()) => {
  const [row] = await tx
    .select({ total: sum(cases.costMicroUsd) })
    .from(cases)
    .where(gte(cases.createdAt, monthStart(now)));
  return Number(row?.total ?? 0);
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
