// Billing on our cloud (spec 16a): the organization's plan and prepaid
// credits (PRE-96), starting a plan through Autumn's checkout, which collects
// a card, changing it, buying credits and setting auto-reload. Owners handle
// billing (spec 2) and their changes are audited. Where billing is off, every
// route answers 404.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import { HTTPException } from "hono/http-exception";

import { autumn, type AutumnAttached } from "../autumn.ts";
import {
  CREDITS,
  CREDITS_PLAN,
  MIN_TOP_UP_CREDITS,
  cloudPlan,
  organizationName,
  planRequired,
  readCredits,
  readPlan,
} from "../billing.ts";
import { eventBase, type OrgVariables } from "../caller.ts";
import type { Env } from "../env.ts";
import { spendingLimit } from "../spend.ts";

const OrgParam = z.object({ org: z.string() });

const credits = z.number().int().openapi({ description: "Credits of $0.01" });

const AutoReload = z
  .object({
    enabled: z.boolean(),
    belowCredits: credits.openapi({
      description: "Buy more when the balance falls below this many credits",
    }),
    addCredits: credits.openapi({ description: "Credits each reload buys" }),
    monthlyLimitUsd: z.number().nullable().openapi({
      description: "The most auto-reload charges in a month; null is no cap",
    }),
  })
  .openapi("AutoReload");

const Billing = z
  .object({
    plan: z.enum(["free", "team", "enterprise", "internal"]),
    started: z.boolean().openapi({
      description: "Whether the organization has started a plan",
    }),
    required: z.boolean().openapi({
      description:
        "Whether the organization must start a plan at checkout before it can start cases or use models",
    }),
    seats: z
      .number()
      .nullable()
      .openapi({ description: "The plan's seat limit; null is no limit" }),
    credits: z
      .object({
        remaining: credits.openapi({ description: "Credits left" }),
        owed: credits.openapi({
          description:
            "Credits used past the balance, which the next purchase pays first",
        }),
      })
      .nullable()
      .openapi({
        description:
          "Free and Team pay a case's usage from prepaid credits; null on other plans",
      }),
    autoReload: AutoReload.nullable(),
    card: z
      .object({ brand: z.string(), last4: z.string() })
      .nullable()
      .openapi({ description: "The card on file, shown to the Owner only" }),
  })
  .openapi("Billing");

const Purchase = z
  .object({
    url: z.string().url().nullable().openapi({
      description:
        "Stripe's page to finish payment on (no card yet, card authentication or a declined card); null when the card on file was charged",
    }),
  })
  .openapi("BillingPurchase");

const returnTo = z
  .string()
  .url()
  .optional()
  .openapi({ description: "Where Stripe's page returns to" });

const off = () =>
  new HTTPException(404, { message: "Billing is not available here." });

const requireOwner = (vars: OrgVariables, message: string) => {
  if (vars.caller.type !== "person" || vars.caller.role !== "owner")
    throw new HTTPException(403, { message });
};

const OWNER_ONLY = "Only the organization's Owner can manage billing.";

const backTo = (env: Env, url: string | undefined) => {
  const back = url ?? `${env.APP_URL}/`;
  if (new URL(back).origin !== new URL(env.APP_URL).origin)
    throw new HTTPException(400, { message: "returnTo must be on this app." });
  return back;
};

const prepaid = (plan: { name: string; started: boolean }) =>
  plan.started && (plan.name === "free" || plan.name === "team");

const readAutoReload = (
  topUps: {
    feature_id: string;
    enabled: boolean;
    threshold: number;
    quantity: number;
    purchase_limit?: { limit: number };
  }[] = [],
) => {
  const topUp = topUps.find((t) => t.feature_id === CREDITS);
  return topUp
    ? {
        enabled: topUp.enabled,
        belowCredits: topUp.threshold,
        addCredits: topUp.quantity,
        monthlyLimitUsd: topUp.purchase_limit?.limit ?? null,
      }
    : null;
};

const paymentUrl = (attached: AutumnAttached) => attached.payment_url ?? null;

export const billingRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/billing",
      tags: ["Billing"],
      summary: "The organization's plan and credits",
      request: { params: OrgParam },
      responses: {
        200: {
          content: { "application/json": { schema: Billing } },
          description: "The plan",
        },
        404: { description: "Billing is off" },
      },
    }),
    async (c) => {
      const plan = await cloudPlan(c.env, c.var.org);
      const billing = autumn(c.env);
      if (!plan || !billing) throw off();
      const owner =
        c.var.caller.type === "person" && c.var.caller.role === "owner";
      const customer = prepaid(plan)
        ? await billing.customer(
            c.var.org,
            undefined,
            owner ? "payment_method" : undefined,
          )
        : null;
      const card = owner ? customer?.payment_method?.card : undefined;
      return c.json(
        {
          plan: plan.name,
          started: plan.started,
          required: planRequired(c.env, c.var.org, plan.started),
          seats: plan.seats,
          credits: customer ? readCredits(customer) : null,
          autoReload: customer
            ? readAutoReload(customer.billing_controls?.auto_topups)
            : null,
          card: card ? { brand: card.brand, last4: card.last4 } : null,
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/billing/checkout",
      tags: ["Billing"],
      summary:
        "Start Free or Team at checkout (Owner). Every plan needs a card; Enterprise is arranged with us.",
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                plan: z.enum(["free", "team"]),
                returnTo: returnTo.openapi({
                  description: "Where checkout returns to",
                }),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ url: z.string().url() }),
            },
          },
          description: "The checkout page to send the Owner to",
        },
        403: { description: "Not the Owner" },
        409: { description: "Already on this plan" },
        404: { description: "Billing is off" },
      },
    }),
    async (c) => {
      requireOwner(c.var, "Only the organization's Owner can change its plan.");
      const billing = autumn(c.env);
      if (!billing) throw off();
      const { plan, returnTo } = c.req.valid("json");
      const back = backTo(c.env, returnTo);
      const current = readPlan(
        await billing.customer(
          c.var.org,
          await organizationName(c.env, c.var.org),
        ),
      );
      if (current.started && current.name === plan)
        throw new HTTPException(409, {
          message: "The organization is already on this plan.",
        });
      const { url } = await billing.checkout(c.var.org, plan, back);
      return c.json({ url }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/billing/plan/preview",
      tags: ["Billing"],
      summary: "What changing to Free or Team would charge (Owner)",
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({ plan: z.enum(["free", "team"]) }),
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z
                .object({
                  totalUsd: z.number().openapi({ description: "Charged now" }),
                  lines: z.array(
                    z.object({ description: z.string(), totalUsd: z.number() }),
                  ),
                  nextInvoice: z
                    .object({ at: z.string(), totalUsd: z.number() })
                    .nullable(),
                })
                .openapi("PlanPreview"),
            },
          },
          description: "The charge",
        },
        403: { description: "Not the Owner" },
        404: { description: "Billing is off" },
      },
    }),
    async (c) => {
      requireOwner(c.var, OWNER_ONLY);
      const billing = autumn(c.env);
      if (!billing) throw off();
      const { plan } = c.req.valid("json");
      const preview = await billing.preview(c.var.org, { planId: plan });
      return c.json(
        {
          totalUsd: preview.total,
          lines: preview.line_items.map((line) => ({
            description: line.description,
            totalUsd: line.total,
          })),
          nextInvoice: preview.next_cycle
            ? {
                at: new Date(preview.next_cycle.starts_at).toISOString(),
                totalUsd: preview.next_cycle.total,
              }
            : null,
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/billing/plan",
      tags: ["Billing"],
      summary:
        "Change between Free and Team (Owner), once a plan is started at checkout",
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({ plan: z.enum(["free", "team"]), returnTo }),
            },
          },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: Purchase } },
          description: "The change, or Stripe's page to finish it on",
        },
        403: { description: "Not the Owner" },
        409: { description: "No plan started yet, or already on this plan" },
        404: { description: "Billing is off" },
      },
    }),
    async (c) => {
      requireOwner(c.var, "Only the organization's Owner can change its plan.");
      const billing = autumn(c.env);
      if (!billing) throw off();
      const { plan, returnTo } = c.req.valid("json");
      const back = backTo(c.env, returnTo);
      const current = readPlan(await billing.customer(c.var.org));
      if (!current.started)
        throw new HTTPException(409, {
          message: "Start a plan at checkout first.",
        });
      if (current.name === plan)
        throw new HTTPException(409, {
          message: "The organization is already on this plan.",
        });
      const attached = await billing.attach(c.var.org, {
        planId: plan,
        successUrl: back,
      });
      await withOrg(c.env, c.var.org, (tx) =>
        audit(tx, {
          ...eventBase(c.var),
          action: "billing.plan_changed",
          targetType: "organization",
          targetId: c.var.org,
          data: { from: current.name, to: plan },
        }),
      );
      return c.json({ url: paymentUrl(attached) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/billing/credits",
      tags: ["Billing"],
      summary: `Buy credits at $0.01 each, at least ${MIN_TOP_UP_CREDITS} (Owner; Free and Team)`,
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                credits: credits.min(MIN_TOP_UP_CREDITS).max(10_000_000),
                returnTo,
              }),
            },
          },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: Purchase } },
          description: "The purchase, or Stripe's page to finish it on",
        },
        403: { description: "Not the Owner" },
        409: { description: "Not on Free or Team" },
        404: { description: "Billing is off" },
      },
    }),
    async (c) => {
      requireOwner(c.var, OWNER_ONLY);
      const billing = autumn(c.env);
      const plan = await cloudPlan(c.env, c.var.org);
      if (!billing || !plan) throw off();
      if (!prepaid(plan))
        throw new HTTPException(409, {
          message: "Credits are bought on the Free and Team plans.",
        });
      const { credits: quantity, returnTo } = c.req.valid("json");
      const attached = await billing.attach(c.var.org, {
        planId: CREDITS_PLAN,
        quantities: { [CREDITS]: quantity },
        successUrl: backTo(c.env, returnTo),
      });
      await withOrg(c.env, c.var.org, (tx) =>
        audit(tx, {
          ...eventBase(c.var),
          action: "billing.credits_bought",
          targetType: "organization",
          targetId: c.var.org,
          data: { credits: quantity, paid: !attached.payment_url },
        }),
      );
      return c.json({ url: paymentUrl(attached) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/billing/auto-reload",
      tags: ["Billing"],
      summary:
        "Buy credits by themselves when the balance runs low (Owner; Free and Team). The monthly cap defaults to the spending limit.",
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                enabled: z.boolean(),
                belowCredits: credits.min(0).max(10_000_000),
                addCredits: credits.min(MIN_TOP_UP_CREDITS).max(10_000_000),
                monthlyLimitUsd: z
                  .number()
                  .positive()
                  .max(1e9)
                  .nullable()
                  .optional()
                  .openapi({
                    description:
                      "The most auto-reload charges in a month; omitted, the spending limit; null, no cap",
                  }),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: AutoReload } },
          description: "The auto-reload settings",
        },
        403: { description: "Not the Owner" },
        409: { description: "Not on Free or Team" },
        404: { description: "Billing is off" },
      },
    }),
    async (c) => {
      requireOwner(c.var, OWNER_ONLY);
      const billing = autumn(c.env);
      const plan = await cloudPlan(c.env, c.var.org);
      if (!billing || !plan) throw off();
      if (!prepaid(plan))
        throw new HTTPException(409, {
          message: "Credits are bought on the Free and Team plans.",
        });
      const body = c.req.valid("json");
      const limit =
        body.monthlyLimitUsd === undefined
          ? await withOrg(c.env, c.var.org, async (tx) => {
              const micro = await spendingLimit(tx);
              return micro === null ? null : micro / 1_000_000;
            })
          : body.monthlyLimitUsd;
      const customer = await billing.setAutoTopUp(c.var.org, {
        feature_id: CREDITS,
        enabled: body.enabled,
        threshold: body.belowCredits,
        quantity: body.addCredits,
        ...(limit !== null && {
          purchase_limit: { limit_type: "amount", interval: "month", limit },
        }),
      });
      const saved = readAutoReload(customer.billing_controls?.auto_topups) ?? {
        enabled: body.enabled,
        belowCredits: body.belowCredits,
        addCredits: body.addCredits,
        monthlyLimitUsd: limit,
      };
      await withOrg(c.env, c.var.org, (tx) =>
        audit(tx, {
          ...eventBase(c.var),
          action: "billing.auto_reload_updated",
          targetType: "organization",
          targetId: c.var.org,
          data: saved,
        }),
      );
      return c.json(saved, 200);
    },
  );
