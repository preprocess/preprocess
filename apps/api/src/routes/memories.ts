// Supervised memory (spec 10): the rules an agent proposed on a case, which
// a person with operator access accepts or dismisses in the Review tab, and
// the accepted rules each agent keeps until someone deletes one.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { cases, reviewEvents } from "@preprocess/db/schema/cases";
import { agentMemories, MEMORY_CAP } from "@preprocess/db/schema/memories";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { Context } from "hono";

import { agentRole, canSeeCase, canWorkCase, mayApprove } from "../access.ts";
import { eventBase } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import type { Env } from "../env.ts";

type Ctx = Context<{ Bindings: Env; Variables: OrgVariables }>;

const OrgParam = z.object({ org: z.string() });
const AgentParam = OrgParam.extend({ agent: z.string() });
const AgentMemoryParam = AgentParam.extend({ memory: z.string() });
const CaseParam = OrgParam.extend({ id: z.string() });
const CaseMemoryParam = CaseParam.extend({ memory: z.string() });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const error = (description: string) =>
  json(
    z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
    description,
  );

const Memory = z
  .object({
    id: z.string(),
    agentId: z.string(),
    caseId: z.string().openapi({ description: "The case it was proposed on" }),
    text: z.string(),
    reason: z.string().nullable().openapi({
      description: "Why the agent proposed it",
    }),
    status: z.enum(["proposed", "accepted", "dismissed", "deleted"]),
    proposedAt: z.string(),
    decidedBy: z.string().nullable(),
    decidedAt: z.string().nullable(),
  })
  .openapi("Memory");

type Row = typeof agentMemories.$inferSelect;

const view = (m: Row): z.infer<typeof Memory> => ({
  id: m.id,
  agentId: m.agentId,
  caseId: m.caseId,
  text: m.text,
  reason: m.reason,
  status: m.status,
  proposedAt: m.proposedAt.toISOString(),
  decidedBy: m.decidedBy,
  decidedAt: m.decidedAt?.toISOString() ?? null,
});

const findAgent = async (tx: Tx, slug: string) => {
  const [agent] = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.slug, slug));
  if (!agent) throw new ApiError(404, "not_found", "No such agent.");
  return agent;
};

const personOf = (vars: OrgVariables) =>
  vars.caller.type === "person" ? vars.caller.userId : vars.caller.keyId;

export const memoryRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>({
  defaultHook: (result, c) => {
    if (!result.success)
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: result.error.issues[0]?.message ?? "Invalid request.",
          },
        },
        400,
      );
  },
})
  .openapi(
    createRoute({
      method: "get",
      path: "/agents/{agent}/memories",
      tags: ["Memory"],
      summary: "List an agent's memory rules",
      description:
        "Accepted rules by default, oldest first: the order the agent reads them in. Ask for proposed rules to see what waits for a person.",
      request: {
        params: AgentParam,
        query: z.object({
          status: z.enum(["accepted", "proposed"]).default("accepted"),
        }),
      },
      responses: {
        200: json(
          z.object({
            memories: z.array(Memory),
            cap: z.number().openapi({
              description: "Accepted and proposed rules the agent may hold",
            }),
          }),
          "The rules",
        ),
        404: error("No such agent, or no access to it"),
      },
    }),
    async (c) => {
      const { agent: slug } = c.req.valid("param");
      const { status } = c.req.valid("query");
      const memories = await withOrg(c.env, c.var.org, async (tx) => {
        const agent = await findAgent(tx, slug);
        if (
          !canSeeCase(c.var.caller, await agentRole(tx, c.var.caller, agent.id))
        )
          throw new ApiError(404, "not_found", "No such agent.");
        return tx
          .select()
          .from(agentMemories)
          .where(
            and(
              eq(agentMemories.agentId, agent.id),
              eq(agentMemories.status, status),
            ),
          )
          .orderBy(
            status === "accepted"
              ? asc(agentMemories.decidedAt)
              : desc(agentMemories.proposedAt),
            asc(agentMemories.id),
          );
      });
      return c.json({ memories: memories.map(view), cap: MEMORY_CAP }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/agents/{agent}/memories/{memory}",
      tags: ["Memory"],
      summary: "Delete an accepted memory rule",
      description:
        "New cases and reruns stop receiving it, and no read returns it again. Its text is kept until the organization's case retention period purges it. Developers, Owners, Admins, API keys and the agent's operators may delete.",
      request: { params: AgentMemoryParam },
      responses: {
        204: { description: "Deleted" },
        403: error("Needs operator access to the agent"),
        404: error("No such accepted rule"),
      },
    }),
    async (c) => {
      const { agent: slug, memory } = c.req.valid("param");
      await withOrg(c.env, c.var.org, async (tx) => {
        const agent = await findAgent(tx, slug);
        const role = await agentRole(tx, c.var.caller, agent.id);
        const admin =
          c.var.caller.role === "owner" || c.var.caller.role === "admin";
        if (!admin && !canWorkCase(role)) {
          if (!canSeeCase(c.var.caller, role))
            throw new ApiError(404, "not_found", "No such agent.");
          throw new ApiError(
            403,
            "forbidden",
            "Deleting a rule needs operator access to the agent.",
          );
        }
        const [deleted] = await tx
          .update(agentMemories)
          .set({
            status: "deleted",
            deletedBy: personOf(c.var),
            deletedAt: new Date(),
          })
          .where(
            and(
              eq(agentMemories.id, memory),
              eq(agentMemories.agentId, agent.id),
              eq(agentMemories.status, "accepted"),
            ),
          )
          .returning();
        if (!deleted)
          throw new ApiError(404, "not_found", "No such accepted rule.");
        await audit(tx, {
          ...eventBase(c.var),
          action: "agent.memory.deleted",
          targetType: "agent",
          targetId: agent.id,
          data: { memory },
        });
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/cases/{id}/memories",
      tags: ["Memory"],
      summary: "The memory rules the agent proposed on a case",
      description:
        "Every proposal from this case with its decision, oldest first, except deleted rules. The Review tab shows the proposed ones.",
      request: { params: CaseParam },
      responses: {
        200: json(z.object({ memories: z.array(Memory) }), "The proposals"),
        404: error("No such case"),
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const memories = await withOrg(c.env, c.var.org, async (tx) => {
        const [found] = await tx
          .select({ agentId: cases.agentId })
          .from(cases)
          .where(eq(cases.id, id));
        if (
          !found ||
          !canSeeCase(
            c.var.caller,
            await agentRole(tx, c.var.caller, found.agentId),
          )
        )
          throw new ApiError(404, "not_found", "No such case.");
        return tx
          .select()
          .from(agentMemories)
          .where(
            and(
              eq(agentMemories.caseId, id),
              ne(agentMemories.status, "deleted"),
            ),
          )
          .orderBy(asc(agentMemories.proposedAt), asc(agentMemories.id));
      });
      return c.json({ memories: memories.map(view) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cases/{id}/memories/{memory}/accept",
      tags: ["Memory"],
      summary: "Accept a rule the agent proposed",
      description:
        "From now on every new case and rerun of the agent receives it. Only a person with operator access decides; API keys cannot.",
      request: { params: CaseMemoryParam },
      responses: {
        200: json(Memory, "The accepted rule"),
        403: error("Needs a person with operator access to the agent"),
        404: error("No such proposal"),
        409: error("Already decided"),
      },
    }),
    (c) => decide(c, c.req.valid("param"), "accepted"),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/cases/{id}/memories/{memory}/dismiss",
      tags: ["Memory"],
      summary: "Dismiss a rule the agent proposed",
      description:
        "The agent never receives it. Only a person with operator access decides; API keys cannot.",
      request: { params: CaseMemoryParam },
      responses: {
        200: json(Memory, "The dismissed rule"),
        403: error("Needs a person with operator access to the agent"),
        404: error("No such proposal"),
        409: error("Already decided"),
      },
    }),
    (c) => decide(c, c.req.valid("param"), "dismissed"),
  );

const decide = async (
  c: Ctx,
  { id: caseId, memory: memoryId }: { id: string; memory: string },
  decision: "accepted" | "dismissed",
) => {
  const decided = await withOrg(c.env, c.var.org, async (tx) => {
    const [found] = await tx
      .select()
      .from(agentMemories)
      .where(
        and(eq(agentMemories.id, memoryId), eq(agentMemories.caseId, caseId)),
      );
    const role = found
      ? await agentRole(tx, c.var.caller, found.agentId)
      : null;
    if (!found || !canSeeCase(c.var.caller, role))
      throw new ApiError(404, "not_found", "No such proposal.");
    if (!(await mayApprove(tx, c.var.caller, found.agentId, null)))
      throw new ApiError(
        403,
        "forbidden",
        "Deciding a rule needs a person with operator access to the agent.",
      );
    if (found.status !== "proposed")
      throw new ApiError(409, "memory_decided", `The rule is ${found.status}.`);
    const userId = personOf(c.var);
    const [row] = await tx
      .update(agentMemories)
      .set({ status: decision, decidedBy: userId, decidedAt: new Date() })
      .where(eq(agentMemories.id, memoryId))
      .returning();
    await tx.insert(reviewEvents).values({
      id: newId("reviewEvent"),
      organizationId: c.var.org,
      caseId,
      userId,
      kind: `memory.${decision}`,
      path: null,
      before: null,
      after: { memory: memoryId, text: found.text },
      checks: null,
    });
    await audit(tx, {
      ...eventBase(c.var),
      action: `case.memory.${decision}`,
      targetType: "case",
      targetId: caseId,
      caseId,
      data: { memory: memoryId, agent: found.agentId },
    });
    return row!;
  });
  return c.json(view(decided), 200);
};
