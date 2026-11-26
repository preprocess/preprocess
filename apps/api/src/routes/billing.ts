// Billing on our cloud (spec 16a): the organization's plan, and starting one
// through Autumn's checkout, which collects a card. Owners handle billing
// (spec 2). Where billing is off, both answer 404.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { autumn } from "../autumn.ts";
import {
  cloudPlan,
  organizationName,
  planRequired,
  readPlan,
} from "../billing.ts";
import type { OrgVariables } from "../caller.ts";
import type { Env } from "../env.ts";

const OrgParam = z.object({ org: z.string() });

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
  })
  .openapi("Billing");

const off = () =>
  new HTTPException(404, { message: "Billing is not available here." });

export const billingRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/billing",
      tags: ["Billing"],
      summary: "The organization's plan",
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
      if (!plan) throw off();
      return c.json(
        {
          plan: plan.name,
          started: plan.started,
          required: planRequired(c.env, c.var.org, plan.started),
          seats: plan.seats,
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
                returnTo: z
                  .string()
                  .url()
                  .optional()
                  .openapi({ description: "Where checkout returns to" }),
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
      if (c.var.caller.type !== "person" || c.var.caller.role !== "owner")
        throw new HTTPException(403, {
          message: "Only the organization's Owner can change its plan.",
        });
      const billing = autumn(c.env);
      if (!billing) throw off();
      const { plan, returnTo } = c.req.valid("json");
      const back = returnTo ?? `${c.env.APP_URL}/`;
      if (new URL(back).origin !== new URL(c.env.APP_URL).origin)
        throw new HTTPException(400, {
          message: "returnTo must be on this app.",
        });
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
  );
