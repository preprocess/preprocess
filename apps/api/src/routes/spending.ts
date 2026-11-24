// The spending-limit guardrail (spec 5, design doc 04): this month's spend
// against the limit, and setting it. Optional, none by default. Only an Owner
// or Admin changes it, and their change is the approval a loosening needs.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { organizationGuardrails } from "@preprocess/db/schema/guardrails";

import { actor, eventBase, requireAdmin } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import type { Env } from "../env.ts";
import { monthSpend, monthStart, spendingLimit } from "../spend.ts";

const OrgParam = z.object({ org: z.string() });

const toUsd = (micro: number) => micro / 1_000_000;
export const toMicro = (usd: number) => Math.round(usd * 1_000_000);

const Spending = z
  .object({
    month: z.string().openapi({ example: "2026-11" }),
    spentUsd: z.number().openapi({
      description:
        "Metered use of the hosted service this calendar month (UTC), every deployment included",
    }),
    limitUsd: z
      .number()
      .nullable()
      .openapi({ description: "Monthly limit; null is no limit" }),
    reached: z.boolean(),
  })
  .openapi("Spending");

const read = async (tx: Tx) => {
  const now = new Date();
  const [limit, spent] = await Promise.all([
    spendingLimit(tx),
    monthSpend(tx, now),
  ]);
  return {
    month: monthStart(now).toISOString().slice(0, 7),
    spentUsd: toUsd(spent),
    limitUsd: limit === null ? null : toUsd(limit),
    reached: limit !== null && spent >= limit,
  };
};

// Sets the limit and audits the change with its old and new values; the
// caller is the Owner or Admin whose change is the approval.
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
      const body = await withOrg(c.env, c.var.org, async (tx) => {
        await setSpendingLimit(tx, c.var, next);
        return read(tx);
      });
      return c.json(body, 200);
    },
  );
