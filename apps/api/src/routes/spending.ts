// The spending-limit guardrail (spec 5, design doc 04): this month's spend
// against the limit, and setting it. Optional, none by default. Only an Owner
// or Admin changes it, and their change is the approval a loosening needs.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { organizationGuardrails } from "@preprocess/db/schema/guardrails";

import { amountBucket } from "@preprocess/logs";

import { trackEvent } from "../analytics.ts";
import { actor, eventBase, requireAdmin } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import type { Env } from "../env.ts";
import {
  limitReached,
  monthSpendParts,
  monthStart,
  spendingLimit,
  totalSpend,
} from "../spend.ts";

const OrgParam = z.object({ org: z.string() });

const toUsd = (micro: number) => micro / 1_000_000;
export const toMicro = (usd: number) => Math.round(usd * 1_000_000);

const Spending = z
  .object({
    month: z.string().openapi({ example: "2026-11" }),
    spentUsd: z.number().openapi({
      description:
        "Metered use of the hosted service this calendar month (UTC), every deployment included: cases, eval runs, OCR calls, sandbox time and case fees. The spending limit enforces this total",
    }),
    casesUsd: z.number().openapi({ description: "Of which cases" }),
    evalsUsd: z.number().openapi({ description: "Of which eval runs" }),
    limitUsd: z
      .number()
      .nullable()
      .openapi({ description: "Monthly limit; null is no limit" }),
    reached: z.boolean(),
  })
  .openapi("Spending");

const read = async (tx: Tx) => {
  const now = new Date();
  const limit = await spendingLimit(tx);
  const parts = await monthSpendParts(tx, now);
  const spent = totalSpend(parts);
  return {
    month: monthStart(now).toISOString().slice(0, 7),
    spentUsd: toUsd(spent),
    casesUsd: toUsd(parts.cases),
    evalsUsd: toUsd(parts.evals),
    limitUsd: limit === null ? null : toUsd(limit),
    reached: limitReached(spent, limit),
  };
};

// The spending_limit_set event's properties for a change from before to
// next, in credits of $0.01; null when nothing changed.
export const limitChange = (
  before: number | null,
  next: number | null,
  via: "settings" | "request",
) => {
  if (before === next) return null;
  const credits = next === null ? 0 : Math.round(next / 10_000);
  return {
    limit: next !== null,
    limit_credits: credits,
    limit_bucket: amountBucket(credits),
    loosened: next === null || (before !== null && next > before),
    via,
  };
};

// Sends spending_limit_set once the change's transaction has committed.
export const trackLimitChange = (
  env: Env,
  vars: OrgVariables,
  change: ReturnType<typeof limitChange>,
) =>
  change &&
  trackEvent(
    env,
    "spending_limit_set",
    vars.org,
    vars.caller.type === "person" ? vars.caller.userId : null,
    change,
  );

// Sets the limit and audits the change with its old and new values; the
// caller is the Owner or Admin whose change is the approval. Returns the
// change for trackLimitChange.
export const setSpendingLimit = async (
  tx: Tx,
  vars: OrgVariables,
  next: number | null,
) => {
  const before = await spendingLimit(tx);
  const values = {
    organizationId: vars.org,
    spendingLimitMicroUsd: next,
    updatedBy: actor(vars.caller).actorId,
    updatedAt: new Date(),
  };
  await tx
    .insert(organizationGuardrails)
    .values(values)
    .onConflictDoUpdate({
      target: organizationGuardrails.organizationId,
      set: {
        spendingLimitMicroUsd: next,
        updatedBy: values.updatedBy,
        updatedAt: values.updatedAt,
      },
    });
  if (before !== next)
    await audit(tx, {
      ...eventBase(vars),
      action: "guardrail.updated",
      targetType: "organization",
      targetId: vars.org,
      data: {
        guardrail: "spending_limit",
        loosened: next === null || (before !== null && next > before),
        before: before === null ? null : toUsd(before),
        after: next === null ? null : toUsd(next),
      },
    });
  return limitChange(before, next, "settings");
};

export const spendingRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/spending",
      tags: ["Guardrails"],
      summary: "This month's spend against the spending limit",
      request: { params: OrgParam },
      responses: {
        200: {
          content: { "application/json": { schema: Spending } },
          description: "Spend and limit",
        },
      },
    }),
    async (c) => c.json(await withOrg(c.env, c.var.org, read), 200),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/spending/limit",
      tags: ["Guardrails"],
      summary:
        "Set or remove the monthly spending limit (Owner or Admin; raising or removing it loosens a guardrail)",
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                limitUsd: z.number().nonnegative().max(1e9).nullable(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: Spending } },
          description: "Spend and the new limit",
        },
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const { limitUsd } = c.req.valid("json");
      const next = limitUsd === null ? null : toMicro(limitUsd);
      const { body, change } = await withOrg(c.env, c.var.org, async (tx) => {
        const change = await setSpendingLimit(tx, c.var, next);
        return { body: await read(tx), change };
      });
      await trackLimitChange(c.env, c.var, change);
      return c.json(body, 200);
    },
  );
