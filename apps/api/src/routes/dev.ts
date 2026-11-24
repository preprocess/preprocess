// Local development only, until the cases API lands in build step 3: run one
// case on an agent's production deployment and read it back, so a deployed
// agent can be exercised end to end through the runtime.

import { newId } from "@preprocess/db/ids";
import { withOrg } from "@preprocess/db/client";
import { agents } from "@preprocess/db/schema/access";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { OrgVariables } from "../caller.ts";
import { deploymentTarget, productionDeployment } from "../deploy.ts";
import type { Env } from "../env.ts";

export const devRoutes = new Hono<{ Bindings: Env; Variables: OrgVariables }>();

devRoutes.use("*", async (c, next) => {
  if (c.env.STAGE !== "development") return c.notFound();
  await next();
});

const agentId = async (env: Env, org: OrgVariables["org"], slug: string) => {
  const [agent] = await withOrg(env, org, (tx) =>
    tx.select().from(agents).where(eq(agents.slug, slug)),
  );
  if (!agent) throw new HTTPException(404, { message: "agent not found" });
  return agent.id;
};

devRoutes.post("/agents/:agent/cases", async (c) => {
  const id = await agentId(c.env, c.var.org, c.req.param("agent"));
  const deployment = await productionDeployment(c.env, c.var.org, id);
  if (!deployment)
    throw new HTTPException(409, {
      message: "the agent has no production deployment",
    });
  const { text } = await c.req.json<{ text: string }>();
  const view = await c.env.RUNTIME.startCase({
    ...deploymentTarget(deployment),
    caseId: newId("case"),
    input: { text },
  });
  return c.json(view, 202);
});

devRoutes.get("/agents/:agent/cases/:case", async (c) => {
  const id = await agentId(c.env, c.var.org, c.req.param("agent"));
  return c.json(
    await c.env.RUNTIME.getCase({
      organizationId: c.var.org,
      agentId: id,
      caseId: c.req.param("case"),
    }),
  );
});
