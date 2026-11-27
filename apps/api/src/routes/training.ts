// Training (spec 12a, design doc 10) is Coming soon: training runs, Retrain on
// corrections and the Tinker-compatible training API refuse with 501
// coming_soon until a provider is chosen. With the training switch off
// (training.ts) they answer 404 instead. Capture, datasets, export,
// environments and evals are not here and keep working either way.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import type { OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import type { Env } from "../env.ts";
import { trainingEnabled } from "../training.ts";

const OrgParam = z.object({ org: z.string() });
const AgentParam = OrgParam.extend({ agent: z.string() });

const ErrorBody = z
  .object({ error: z.object({ code: z.string(), message: z.string() }) })
  .openapi("Error");

const TrainingState = z
  .object({
    service: z.enum(["on", "off"]),
    runs: z.literal("coming_soon"),
  })
  .openapi("TrainingState");

const refuse = (env: Env) => {
  if (!trainingEnabled(env))
    throw new ApiError(404, "not_found", "Training is off on this install.");
  throw new ApiError(501, "coming_soon", "Training is coming soon.");
};

const refusal = {
  404: {
    content: { "application/json": { schema: ErrorBody } },
    description: "Training is off on this install (not_found)",
  },
  501: {
    content: { "application/json": { schema: ErrorBody } },
    description: "Training is coming soon (coming_soon)",
  },
};

// The OpenAPI document's Training tag, which says whether it is on here.
export const trainingTag = (env: Env) => ({
  name: "Training",
  description: trainingEnabled(env)
    ? "Training runs, Retrain on corrections and the Tinker-compatible API are coming soon."
    : "Training is off on this install. Its routes answer 404.",
});

export const trainingRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/training",
      tags: ["Training"],
      summary: "Whether Training is on for this install",
      request: { params: OrgParam },
      responses: {
        200: {
          content: { "application/json": { schema: TrainingState } },
          description: "The training switch, and training runs' state",
        },
      },
    }),
    (c) =>
      c.json(
        {
          service: trainingEnabled(c.env) ? ("on" as const) : ("off" as const),
          runs: "coming_soon" as const,
        },
        200,
      ),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/training/runs",
      tags: ["Training"],
      summary: "Start a training run (coming soon)",
      request: { params: OrgParam },
      responses: refusal,
    }),
    (c) => refuse(c.env),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/agents/{agent}/retrain",
      tags: ["Training"],
      summary: "Retrain an agent's model on corrections (coming soon)",
      request: { params: AgentParam },
      responses: refusal,
    }),
    (c) => refuse(c.env),
  )
  // The Tinker-compatible training base URL.
  .all("/training/tinker/*", (c) => refuse(c.env));
