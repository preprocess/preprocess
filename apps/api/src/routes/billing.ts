// Billing on our cloud (spec 16a): the organization's plan and prepaid
// credits (PRE-96), starting a plan through Autumn's checkout, which collects
// a card, changing it, buying credits and setting auto-reload. Owners handle
// billing (spec 2) and their changes are audited. Where billing is off, every
// route answers 404, and so do checkout and the payment portal for an
// organization without a plan until billing holds for it.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { orgId, withOrg } from "@preprocess/db/client";
import { HTTPException } from "hono/http-exception";

import { autumn, type Autumn, type AutumnAttached } from "../autumn.ts";
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
import {
  changePreview,
  checkPicks,
  customEnvironmentAgents,
  demotedAt,
  demotedPeople,
  forgetChange,
  recordChange,
  restoreRoles,
} from "../plan-change.ts";
import { monthUsage } from "../month-usage.ts";
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
    change: z
      .object({
        plan: z.enum(["free", "team", "enterprise", "internal"]),
        at: z.string().nullable(),
      })
      .nullable()
      .openapi({
        description:
          "A plan change waiting for the end of the billing period, and when it takes effect",
      }),
    switched: z
      .object({
        people: z.number().int().openapi({
          description:
            "People who lost their seat when Team ended, whose previous roles the Owner can restore on Team",
        }),
        agents: z
          .array(z.object({ id: z.string(), slug: z.string() }))
          .openapi({
            description:
              "Agents paused because they use a custom environment, which resume on Team",
          }),
        at: z.string().nullable().openapi({
          description:
            "When Team ended for the people who lost their seat; null when nobody did",
        }),
      })
      .nullable()
      .openapi({
        description:
          "What moving down from Team changed, shown to Owners and Admins; null when nothing or for others",
      }),
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
      .object({
        brand: z.string(),
        last4: z.string(),
        expMonth: z.number().int(),
        expYear: z.number().int(),
      })
      .nullable()
      .openapi({ description: "The card on file, shown to the Owner only" }),
    email: z.string().nullable().openapi({
      description: "Where invoices and receipts go, shown to the Owner only",
    }),
    pastDue: z.boolean().openapi({
      description:
        "Whether a subscription payment failed and is still owed, shown to Owners and Admins; false for others",
    }),
    invoices: z
      .array(
        z.object({
          id: z.string(),
          at: z.string().openapi({ description: "When it was issued" }),
          totalUsd: z.number(),
          status: z.string().openapi({ description: "Such as paid or open" }),
          url: z.string().nullable().openapi({
            description: "The invoice's page, to view and pay it",
          }),
        }),
      )
      .openapi({
        description: "The newest 3 invoices, shown to the Owner only",
      }),
    commit: z
      .object({ usedUsd: z.number(), totalUsd: z.number() })
      .nullable()
      .openapi({
        description:
          "Enterprise's annual commit and how much of it is drawn down; null on other plans",
      }),
  })
  .openapi("Billing");

const Usage = z
  .object({
    month: z.string().openapi({ example: "2026-11" }),
    seats: z.object({
      count: z.number().int().openapi({ description: "Active seats" }),
      includedCount: z.number().int(),
      usd: z.number(),
    }),
    cases: z.object({
      count: z.number().int(),
      includedCount: z.number().int(),
      usd: z.number().openapi({ description: "Case fees" }),
    }),
    modelUsageUsd: z.number(),
    decideUsd: z.number(),
    ocrUsd: z.number(),
    sandboxUsd: z.number(),
    storage: z.object({
      gbMonths: z.number(),
      includedGbMonths: z.number(),
      usd: z.number(),
    }),
    byAgent: z
      .array(
        z.object({
          agentId: z.string().nullable().openapi({
            description:
              "Null for usage with no agent: the OCR API, or a case that is gone",
          }),
          slug: z.string().nullable(),
          cases: z.number().int(),
          casesUsd: z.number().openapi({ description: "Case fees" }),
          modelUsageUsd: z.number(),
          decideUsd: z.number(),
          ocrUsd: z.number(),
          sandboxUsd: z.number(),
        }),
      )
      .openapi({
        description:
          "Cases and each usage line by agent, through the case or eval case it was charged to. Each line's agents add up to it exactly: each agent's amount is floored to the cent, and the cents flooring dropped go one each to the agents with the largest fractions of a cent.",
      }),
    paidFromCreditsUsd: z.number().openapi({
      description: "Model usage, decide, OCR, sandbox time and case fees",
    }),
    billedAtMonthEndUsd: z.number().openapi({
      description: "Seats and storage past the allowance",
    }),
    daily: z.array(z.object({ day: z.string(), usd: z.number() })).openapi({
      description:
        "Usage paid from credits on each UTC day from the 1st to today",
    }),
    now: z.object({
      seats: z.number().int().openapi({ description: "Seats held now" }),
      seatLimit: z.number().int().nullable(),
      casesThisMonth: z.number().int(),
      caseLimit: z.number().int().nullable(),
      storageGb: z.number().openapi({ description: "Stored now" }),
      storageIncludedGb: z.number(),
    }),
  })
  .openapi("BillingUsage");

const action = z
  .enum(["confirm_payment", "card_declined", "add_card"])
  .nullable()
  .openapi({
    description:
      "Why the Owner must finish on the payment page: the bank needs to confirm the payment, the card was declined, or there is no card on file; null when the card on file was charged or a new card was asked for",
  });

const Purchase = z
  .object({
    url: z.string().url().nullable().openapi({
      description:
        "The payment page to send the Owner to when the card on file can't be charged (no card yet, the bank needs to confirm the payment, or the card was declined) or a new card was asked for; null when the card on file was charged",
    }),
    action,
  })
  .openapi("BillingPurchase");

const returnTo = z
  .string()
  .url()
  .optional()
  .openapi({ description: "Where the Owner returns after paying" });

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

const ACTIONS: Record<string, z.infer<typeof action>> = {
  "3ds_required": "confirm_payment",
  payment_failed: "card_declined",
  payment_method_required: "add_card",
};

// What the Owner must do on the payment page, from Autumn's required action;
// a payment page with no reason Autumn names means adding a card when there
// is none on file.
const paymentAction = async (
  billing: Autumn,
  org: string,
  attached: AutumnAttached,
) => {
  if (!attached.payment_url) return null;
  const known = attached.required_action
    ? ACTIONS[attached.required_action.code]
    : undefined;
  if (known) return known;
  const { payment_method } = await billing.customer(org, undefined, [
    "payment_method",
  ]);
  return payment_method?.card ? null : "add_card";
};

// Enterprise is arranged with us, and so is any change to it (Chip).
const refuseFixedPlan = (plan: string) => {
  if (plan === "enterprise")
    throw new HTTPException(409, {
      message: "Contact us to change an Enterprise plan.",
    });
};

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
      const customer =
        plan.started && plan.name !== "internal"
          ? await billing.customer(
              c.var.org,
              undefined,
              owner ? ["invoices", "payment_method"] : [],
            )
          : null;
      const card = owner ? customer?.payment_method?.card : undefined;
      const commit =
        plan.name === "enterprise" ? customer?.balances.commit : undefined;
      const manager =
        c.var.caller.type === "person" &&
        (c.var.caller.role === "owner" || c.var.caller.role === "admin");
      const switched = manager
        ? await withOrg(c.env, orgId(c.var.org), async (tx) => ({
            people: (await demotedPeople(tx)).length,
            agents: plan.features.has("custom_sandbox_images")
              ? []
              : await customEnvironmentAgents(tx),
            at: (await demotedAt(tx))?.toISOString() ?? null,
          }))
        : null;
      return c.json(
        {
          plan: plan.name,
          started: plan.started,
          required: planRequired(c.env, c.var.org, plan.started),
          seats: plan.seats,
          change: plan.change && {
            plan: plan.change.plan,
            at: plan.change.at?.toISOString() ?? null,
          },
          switched:
            switched && (switched.people || switched.agents.length)
              ? switched
              : null,
          credits: customer && prepaid(plan) ? readCredits(customer) : null,
          autoReload:
            customer && prepaid(plan)
              ? readAutoReload(customer.billing_controls?.auto_topups)
              : null,
          card: card
            ? {
                brand: card.brand,
                last4: card.last4,
                expMonth: card.exp_month,
                expYear: card.exp_year,
              }
            : null,
          email: (owner && customer?.email) || null,
          pastDue: Boolean(
            manager && customer?.subscriptions.some((s) => s.past_due),
          ),
          invoices: owner
            ? [...(customer?.invoices ?? [])]
                .sort((a, b) => b.created_at - a.created_at)
                .slice(0, 3)
                .map((invoice) => ({
                  id: invoice.id,
                  at: new Date(invoice.created_at).toISOString(),
                  totalUsd: invoice.total,
                  status: invoice.status,
                  url: invoice.hosted_invoice_url ?? null,
                }))
            : [],
          commit: commit
            ? {
                usedUsd: Math.floor(commit.usage) / 100,
                totalUsd: Math.floor(commit.granted) / 100,
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
      path: "/billing/checkout",
      tags: ["Billing"],
      summary:
        "Start Free or Team at checkout (Owner). Every plan needs a card, and Team starts with its first credits; Enterprise is arranged with us.",
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                plan: z.enum(["free", "team"]),
                credits: credits
                  .min(MIN_TOP_UP_CREDITS)
                  .max(10_000_000)
                  .default(MIN_TOP_UP_CREDITS)
                  .openapi({
                    description: `Team's first credits, bought at checkout so it never starts at zero; at least and by default ${MIN_TOP_UP_CREDITS} ($10)`,
                  }),
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
              schema: z
                .object({
                  url: z.string().url().openapi({
                    description:
                      "The checkout page to send the Owner to, or returnTo when Team was charged to the card on file",
                  }),
                  paid: z.boolean().openapi({
                    description:
                      "Whether Team and its first credits were charged to the card on file, with nothing left to do",
                  }),
                  action,
                })
                .openapi("BillingCheckout"),
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
      const { plan, credits: first, returnTo } = c.req.valid("json");
      const back = backTo(c.env, returnTo);
      const current = readPlan(
        await billing.customer(
          c.var.org,
          await organizationName(c.env, c.var.org),
        ),
      );
      if (!current.started && !planRequired(c.env, c.var.org, false))
        throw off();
      if (current.started) refuseFixedPlan(current.name);
      if (current.started && current.name === plan)
        throw new HTTPException(409, {
          message: "The organization is already on this plan.",
        });
      if (plan === "free") {
        const { url } = await billing.checkout(c.var.org, plan, back);
        return c.json({ url, paid: false, action: null }, 200);
      }
      // A card on file is charged at once, and the Owner goes straight back.
      const attached = await billing.attachTogether(
        c.var.org,
        [
          { planId: "team" },
          { planId: CREDITS_PLAN, quantities: { [CREDITS]: first } },
        ],
        back,
      );
      return c.json(
        {
          url: attached.payment_url ?? back,
          paid: !attached.payment_url,
          action: await paymentAction(billing, c.var.org, attached),
        },
        200,
      );
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
        "Change between Free and Team (Owner), once a plan is started at checkout. Moving up to Team is immediate. Moving down to Free cancels Team at the end of its billing period, and the organization keeps its credits; until then the Owner can keep Team. At the switch, the people in keep hold Free's seats and everyone else with a seat becomes a viewer; without keep, Owners keep theirs first, then the most recently active. Enterprise changes go through us.",
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                plan: z.enum(["free", "team"]),
                returnTo,
                keep: z.array(z.string()).max(10).optional().openapi({
                  description:
                    "Moving to Free: the user ids who keep a developer or operator seat, at most 3",
                }),
                reason: z.string().max(2000).optional().openapi({
                  description: "Moving to Free: why, in the Owner's words",
                }),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: Purchase } },
          description: "The change, or the payment page to finish it on",
        },
        403: { description: "Not the Owner" },
        409: {
          description:
            "No plan started yet, already on this plan, or on Enterprise",
        },
        422: { description: "keep names someone without a seat, or too many" },
        404: { description: "Billing is off" },
      },
    }),
    async (c) => {
      requireOwner(c.var, "Only the organization's Owner can change its plan.");
      const billing = autumn(c.env);
      if (!billing) throw off();
      const { plan, returnTo, keep, reason } = c.req.valid("json");
      const back = backTo(c.env, returnTo);
      const customer = await billing.customer(c.var.org);
      const current = readPlan(customer);
      if (!current.started)
        throw new HTTPException(409, {
          message: "Start a plan at checkout first.",
        });
      refuseFixedPlan(current.name);
      if (current.name === plan)
        throw new HTTPException(409, {
          message: "The organization is already on this plan.",
        });
      const down = plan === "free";
      if (down && keep) {
        const refused = await checkPicks(c.env, c.var.org, keep);
        if (refused) throw new HTTPException(422, { message: refused });
      }
      const attached = await billing.attach(c.var.org, {
        planId: plan,
        successUrl: back,
        atPeriodEnd: down,
      });
      await withOrg(c.env, c.var.org, (tx) =>
        audit(tx, {
          ...eventBase(c.var),
          action: "billing.plan_changed",
          targetType: "organization",
          targetId: c.var.org,
          data: {
            from: current.name,
            to: plan,
            ...(down && { keep: keep ?? null, reason: reason ?? null }),
          },
        }),
      );
      if (down) {
        const end = customer.subscriptions.find(
          (s) => s.plan_id === current.name && s.status === "active",
        )?.current_period_end;
        await recordChange(c.env, c.var.org, {
          plan,
          at: end ? new Date(end) : null,
          keep: keep ?? null,
          reason: reason ?? null,
          by: c.var.caller.type === "person" ? c.var.caller.userId : "",
        });
      }
      return c.json(
        {
          url: paymentUrl(attached),
          action: await paymentAction(billing, c.var.org, attached),
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/billing/plan/change",
      tags: ["Billing"],
      summary:
        "Keep the current plan: cancel a plan change waiting for the end of the billing period (Owner)",
      request: { params: OrgParam },
      responses: {
        204: { description: "The plan stays as it is" },
        403: { description: "Not the Owner" },
        409: { description: "No plan change is waiting" },
        404: { description: "Billing is off" },
      },
    }),
    async (c) => {
      requireOwner(c.var, "Only the organization's Owner can change its plan.");
      const billing = autumn(c.env);
      if (!billing) throw off();
      const current = readPlan(await billing.customer(c.var.org));
      const change = current.change;
      if (!change)
        throw new HTTPException(409, {
          message: "No plan change is waiting.",
        });
      await billing.keep(c.var.org, current.name);
      await forgetChange(c.env, c.var.org);
      await withOrg(c.env, c.var.org, (tx) =>
        audit(tx, {
          ...eventBase(c.var),
          action: "billing.plan_change_cancelled",
          targetType: "organization",
          targetId: c.var.org,
          data: { plan: current.name, instead: change.plan },
        }),
      );
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/billing/plan/change/preview",
      tags: ["Billing"],
      summary:
        "What moving from Team to Free changes at the end of the billing period, from live usage (Owner). Only what applies is listed: seats past Free's with everyone who holds one and who would keep theirs, agents that pause, storage billed past Free's, and this month's cases past Free's. An empty list means nothing else changes.",
      request: { params: OrgParam },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z
                .object({
                  at: z.string().nullable().openapi({
                    description: "When Team ends and Free starts",
                  }),
                  items: z.array(
                    z.discriminatedUnion("kind", [
                      z.object({
                        kind: z.literal("seats"),
                        limit: z.number().int(),
                        people: z.array(
                          z.object({
                            userId: z.string(),
                            name: z.string(),
                            email: z.string(),
                            keeps: z.boolean().openapi({
                              description:
                                "Keeps a seat unless the Owner picks otherwise",
                            }),
                          }),
                        ),
                      }),
                      z.object({
                        kind: z.literal("agents"),
                        agents: z.array(
                          z.object({ id: z.string(), slug: z.string() }),
                        ),
                      }),
                      z.object({
                        kind: z.literal("storage"),
                        gb: z.number(),
                        includedGb: z.number(),
                        usdPerMonth: z.number(),
                      }),
                      z.object({
                        kind: z.literal("cases"),
                        thisMonth: z.number().int(),
                        limit: z.number().int(),
                      }),
                    ]),
                  ),
                })
                .openapi("PlanChangePreview"),
            },
          },
          description: "What changes",
        },
        403: { description: "Not the Owner" },
        409: { description: "Not on Team" },
        404: { description: "Billing is off" },
      },
    }),
    async (c) => {
      requireOwner(c.var, "Only the organization's Owner can change its plan.");
      const billing = autumn(c.env);
      if (!billing) throw off();
      const customer = await billing.customer(c.var.org);
      const current = readPlan(customer);
      if (current.name !== "team")
        throw new HTTPException(409, {
          message: "Only organizations on Team can switch to Free.",
        });
      const end =
        current.change?.at ??
        customer.subscriptions.find(
          (s) => s.plan_id === "team" && s.status === "active",
        )?.current_period_end;
      return c.json(
        {
          at: end ? new Date(end).toISOString() : null,
          items: await changePreview(c.env, c.var.org),
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/billing/roles/restore",
      tags: ["Billing"],
      summary:
        "Give everyone who lost their seat when Team ended their previous roles back (Owner, on Team)",
      request: { params: OrgParam },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({
                people: z.number().int().openapi({
                  description: "People whose roles were restored",
                }),
              }),
            },
          },
          description: "Restored",
        },
        403: { description: "Not the Owner" },
        409: { description: "Not on a plan without a seat limit" },
        404: { description: "Billing is off" },
      },
    }),
    async (c) => {
      requireOwner(c.var, "Only the organization's Owner can change its plan.");
      const plan = await cloudPlan(c.env, c.var.org);
      if (!plan) throw off();
      if (!plan.started || plan.seats !== null)
        throw new HTTPException(409, {
          message: "Previous roles can only be restored on the Team plan.",
        });
      const people = await restoreRoles(c.env, c.var.org, {
        actorType: "person",
        actorId: c.var.caller.type === "person" ? c.var.caller.userId : "",
      });
      return c.json({ people }, 200);
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
                newCard: z.boolean().optional().openapi({
                  description:
                    "Pay with a new card on the payment page instead of the card on file; the new card is saved for future charges",
                }),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: Purchase } },
          description: "The purchase, or the payment page to finish it on",
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
      const { credits: quantity, returnTo, newCard } = c.req.valid("json");
      const attached = await billing.attach(c.var.org, {
        planId: CREDITS_PLAN,
        quantities: { [CREDITS]: quantity },
        successUrl: backTo(c.env, returnTo),
        newCard: newCard === true,
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
      return c.json(
        {
          url: paymentUrl(attached),
          action: newCard
            ? null
            : await paymentAction(billing, c.var.org, attached),
        },
        200,
      );
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
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/billing/usage",
      tags: ["Billing"],
      summary:
        "This UTC month so far (Owner): usage by line and by agent, what credits paid, what is billed at month end, usage paid from credits each day, and the plan's meters now. Dollars are floored to the cent.",
      request: { params: OrgParam },
      responses: {
        200: {
          content: { "application/json": { schema: Usage } },
          description: "The month so far",
        },
        403: { description: "Not the Owner" },
        404: { description: "Billing is off" },
      },
    }),
    async (c) => {
      requireOwner(c.var, OWNER_ONLY);
      const plan = await cloudPlan(c.env, c.var.org);
      if (!plan || !autumn(c.env)) throw off();
      return c.json(await monthUsage(c.env, c.var.org, plan), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/billing/portal",
      tags: ["Billing"],
      summary:
        "Open the payment portal (Owner), where the Owner updates the card and the billing email and finds every invoice",
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                returnTo: returnTo.openapi({
                  description: "Where the portal returns to",
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
              schema: z
                .object({ url: z.string().url() })
                .openapi("BillingPortal"),
            },
          },
          description: "The portal page to send the Owner to",
        },
        400: { description: "returnTo is not on this app" },
        403: { description: "Not the Owner" },
        404: { description: "Billing is off" },
      },
    }),
    async (c) => {
      requireOwner(c.var, OWNER_ONLY);
      const billing = autumn(c.env);
      const plan = await cloudPlan(c.env, c.var.org);
      if (
        !billing ||
        !plan ||
        (!plan.started && !planRequired(c.env, c.var.org, false))
      )
        throw off();
      const back = backTo(c.env, c.req.valid("json").returnTo);
      const { url } = await billing.portal(c.var.org, back);
      return c.json({ url }, 200);
    },
  );
