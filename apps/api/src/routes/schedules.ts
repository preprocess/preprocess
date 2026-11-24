// Schedules (design doc 04) are declared in agent code; the API lists them
// and pauses or resumes them by name, never creates them. A pause survives
// deploys until someone resumes it.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import { agents } from "@preprocess/db/schema/access";
import { eq, or } from "drizzle-orm";
import type { Context } from "hono";

import { agentRole, canSeeCase, canWorkCase } from "../access.ts";
import { eventBase } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import type { Env } from "../env.ts";
import { schedulerName } from "../scheduler.ts";

type Ctx = Context<{ Bindings: Env; Variables: OrgVariables }>;

const AgentParam = z.object({ org: z.string(), agent: z.string() });
const ScheduleParam = AgentParam.extend({ name: z.string() });

const Schedule = z
  .object({
    name: z.string(),
    cron: z.string(),
    timezone: z.string(),
    paused: z.boolean(),
    nextRunAt: z.string().nullable(),
    lastCaseId: z.string().nullable(),
    lastError: z
      .string()
      .nullable()
      .openapi({ description: "Why the last fire made no case" }),
  })
  .openapi("Schedule");

// Seeing an agent lists its schedules; pausing one needs operator access, or
// an Owner or Admin.
const loadAgent = async (c: Ctx, slugOrId: string, change: boolean) => {
  const found = await withOrg(c.env, c.var.org, async (tx) => {
    const [agent] = await tx
      .select({ id: agents.id, slug: agents.slug })
      .from(agents)
      .where(or(eq(agents.slug, slugOrId), eq(agents.id, slugOrId)));
    if (!agent) return null;
    return { ...agent, role: await agentRole(tx, c.var.caller, agent.id) };
  });
  if (!found || !canSeeCase(c.var.caller, found.role))
    throw new ApiError(404, "not_found", "No such agent.");
  const admin = c.var.caller.role === "owner" || c.var.caller.role === "admin";
  if (change && !admin && !canWorkCase(found.role))
    throw new ApiError(
      403,
      "forbidden",
      "Pausing a schedule needs operator access to the agent.",
    );
  return found;
};

const scheduler = (c: Ctx, agentId: string) =>
  c.env.SCHEDULER.getByName(schedulerName(c.var.org, agentId));

const toggle = (pause: boolean) => async (c: Ctx) => {
  const { agent: slug, name } = c.req.param() as {
    agent: string;
    name: string;
  };
  const agent = await loadAgent(c, slug, true);
  if (!(await scheduler(c, agent.id).setPaused(name, pause)))
    throw new ApiError(404, "not_found", "No such schedule.");
  await withOrg(c.env, c.var.org, (tx) =>
    audit(tx, {
      ...eventBase(c.var),
      action: pause ? "schedule.paused" : "schedule.resumed",
      targetType: "agent",
      targetId: agent.id,
      data: { agent: agent.slug, schedule: name },
    }),
  );
  const schedules = await scheduler(c, agent.id).list();
  return c.json(
    schedules.find((s) => s.name === name)!,
    200,
  );
};

const pauseRoute = (pause: boolean) =>
  createRoute({
    method: "post",
    path: `/agents/{agent}/schedules/{name}/${pause ? "pause" : "resume"}`,
    tags: ["Schedules"],
    summary: pause
      ? "Pause a schedule until someone resumes it"
      : "Resume a paused schedule from now",
    request: { params: ScheduleParam },
    responses: {
      200: {
        content: { "application/json": { schema: Schedule } },
        description: "The schedule",
      },
    },
  });

export const scheduleRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/agents/{agent}/schedules",
      tags: ["Schedules"],
      summary: "The production deployment's schedules",
      request: { params: AgentParam },
      responses: {
        200: {
          content: { "application/json": { schema: z.array(Schedule) } },
          description: "Schedules",
        },
      },
    }),
    async (c) => {
      const agent = await loadAgent(c, c.req.valid("param").agent, false);
      return c.json(await scheduler(c, agent.id).list(), 200);
    },
  )
  .openapi(pauseRoute(true), toggle(true))
  .openapi(pauseRoute(false), toggle(false));
