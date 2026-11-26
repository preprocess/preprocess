// Training (spec 12a) is Coming soon: training runs, Retrain on corrections
// and the Tinker-compatible training API refuse with 501 coming_soon until a
// provider is chosen. Capture, datasets, export, environments and evals are
// not here and keep working.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import type { OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import type { Env } from "../env.ts";

const OrgParam = z.object({ org: z.string() });
const AgentParam = OrgParam.extend({ agent: z.string() });

const ErrorBody = z
  .object({ error: z.object({ code: z.string(), message: z.string() }) })
  .openapi("Error");

const comingSoon = () => {
  throw new ApiError(501, "coming_soon", "Training is coming soon.");
};

const refusal = {
  501: {
    content: { "application/json": { schema: ErrorBody } },
    description: "Training is coming soon (coming_soon)",
  },
};

export const trainingRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "post",
      path: "/training/runs",
      tags: ["Training"],
      summary: "Start a training run (coming soon)",
      request: { params: OrgParam },
      responses: refusal,
    }),
    comingSoon,
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
    comingSoon,
  )
  // The Tinker-compatible training base URL.
  .all("/training/tinker/*", comingSoon);
