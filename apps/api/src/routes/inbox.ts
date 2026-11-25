// The inbox (design doc 06): cases waiting on the person's groups, mentions of
// their groups, cases assigned to them, and memory rules proposed on the
// agents they work (spec 10), computed on read from membership and
// assignment. Read marks are kept per item key.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { withOrg } from "@preprocess/db/client";
import { agents, groupMembers, groups } from "@preprocess/db/schema/access";
import {
  caseAssignees,
  caseMentions,
  cases,
  inboxReads,
} from "@preprocess/db/schema/cases";
import { agentMemories } from "@preprocess/db/schema/memories";
import { and, desc, eq, inArray, ne, notInArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { workedAgents } from "../access.ts";
import type { Caller, OrgVariables } from "../caller.ts";
import type { Env } from "../env.ts";

const OrgParam = z.object({ org: z.string() });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const MENTIONS = 200;

const InboxItem = z
  .object({
    key: z.string().openapi({
      description:
        '"waiting:<caseId>:<since>", "mention:<id>", "assigned:<caseId>:<at>" or "memory:<id>"',
    }),
    kind: z.enum(["waiting", "mention", "assigned", "memory"]),
    at: z.string().datetime(),
    read: z.boolean(),
    case: z.object({
      id: z.string(),
      agent: z.object({ id: z.string(), slug: z.string() }),
      title: z.string().nullable(),
      status: z.string(),
    }),
    group: z
      .object({ id: z.string(), slug: z.string(), name: z.string() })
      .nullable(),
    message: z.string().nullable().openapi({
      description: "A mention's message, or a proposed memory rule's text",
    }),
  })
  .openapi("InboxItem");

type Item = z.infer<typeof InboxItem>;

const person = (caller: Caller) => {
  if (caller.type !== "person")
    throw new HTTPException(403, {
      message: "The inbox belongs to a person, not an API key.",
    });
  return caller.userId;
};

const caseColumns = {
  id: cases.id,
  agentId: cases.agentId,
  agentSlug: agents.slug,
  title: cases.title,
  status: cases.status,
};

const caseOf = (row: {
  id: string;
  agentId: string;
  agentSlug: string;
  title: string | null;
  status: string;
}) => ({
  id: row.id,
  agent: { id: row.agentId, slug: row.agentSlug },
  title: row.title,
  status: row.status,
});

export const inboxRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/inbox",
      tags: ["Inbox"],
      summary: "The signed-in person's inbox, newest first",
      request: { params: OrgParam },
      responses: {
        200: json(
          z.object({ items: z.array(InboxItem), unread: z.number() }),
          "Inbox items",
        ),
      },
    }),
    async (c) => {
      const userId = person(c.var.caller);
      const items = await withOrg(c.env, c.var.org, async (tx) => {
        const group = { id: groups.id, slug: groups.slug, name: groups.name };
        const worked = await workedAgents(tx, userId);
        const [waiting, mentions, assigned, proposals, reads] =
          await Promise.all([
            tx
              .select({ ...caseColumns, since: cases.waitingSince, group })
              .from(cases)
              .innerJoin(agents, eq(agents.id, cases.agentId))
              .innerJoin(groups, eq(groups.id, cases.waitingOnGroupId))
              .innerJoin(
                groupMembers,
                and(
                  eq(groupMembers.groupId, cases.waitingOnGroupId),
                  eq(groupMembers.userId, userId),
                ),
              )
              .where(eq(cases.status, "waiting")),
            tx
              .select({
                ...caseColumns,
                mentionId: caseMentions.id,
                message: caseMentions.message,
                at: caseMentions.at,
                group,
              })
              .from(caseMentions)
              .innerJoin(cases, eq(cases.id, caseMentions.caseId))
              .innerJoin(agents, eq(agents.id, cases.agentId))
              .innerJoin(groups, eq(groups.id, caseMentions.groupId))
              .innerJoin(
                groupMembers,
                and(
                  eq(groupMembers.groupId, caseMentions.groupId),
                  eq(groupMembers.userId, userId),
                ),
              )
              .where(ne(caseMentions.by, `person:${userId}`))
              .orderBy(desc(caseMentions.at))
              .limit(MENTIONS),
            tx
              .select({ ...caseColumns, at: caseAssignees.assignedAt })
              .from(caseAssignees)
              .innerJoin(cases, eq(cases.id, caseAssignees.caseId))
              .innerJoin(agents, eq(agents.id, cases.agentId))
              .where(
                and(
                  eq(caseAssignees.userId, userId),
                  notInArray(cases.status, ["completed", "cancelled"]),
                ),
              ),
            worked?.length === 0
              ? []
              : tx
                  .select({
                    ...caseColumns,
                    memoryId: agentMemories.id,
                    text: agentMemories.text,
                    at: agentMemories.proposedAt,
                  })
                  .from(agentMemories)
                  .innerJoin(cases, eq(cases.id, agentMemories.caseId))
                  .innerJoin(agents, eq(agents.id, cases.agentId))
                  .where(
                    and(
                      eq(agentMemories.status, "proposed"),
                      worked
                        ? inArray(agentMemories.agentId, worked)
                        : undefined,
                    ),
                  ),
            tx
              .select({ key: inboxReads.itemKey })
              .from(inboxReads)
              .where(eq(inboxReads.userId, userId)),
          ]);
        const read = new Set(reads.map((r) => r.key));
        const all: Omit<Item, "read">[] = [
          ...waiting.map((w) => {
            const at = (w.since ?? new Date(0)).toISOString();
            return {
              key: `waiting:${w.id}:${at}`,
              kind: "waiting" as const,
              at,
              case: caseOf(w),
              group: w.group,
              message: null,
            };
          }),
          ...mentions.map((m) => ({
            key: `mention:${m.mentionId}`,
            kind: "mention" as const,
            at: m.at.toISOString(),
            case: caseOf(m),
            group: m.group,
            message: m.message,
          })),
          ...assigned.map((a) => ({
            key: `assigned:${a.id}:${a.at.toISOString()}`,
            kind: "assigned" as const,
            at: a.at.toISOString(),
            case: caseOf(a),
            group: null,
            message: null,
          })),
          ...proposals.map((m) => ({
            key: `memory:undefined`,
            kind: "memory" as const,
            at: m.at.toISOString(),
            case: caseOf(m),
            group: null,
            message: m.text,
          })),
        ];
        return all
          .map((i) => ({ ...i, read: read.has(i.key) }))
          .sort((a, b) => b.at.localeCompare(a.at));
      });
      return c.json(
        { items, unread: items.filter((i) => !i.read).length },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/inbox/read",
      tags: ["Inbox"],
      summary: "Mark inbox items read",
      request: {
        params: OrgParam,
        body: {
          content: {
            "application/json": {
              schema: z.object({
                keys: z.array(z.string().min(1).max(200)).min(1).max(500),
              }),
            },
          },
          required: true,
        },
      },
      responses: { 204: { description: "Marked" } },
    }),
    async (c) => {
      const userId = person(c.var.caller);
      const { keys } = c.req.valid("json");
      await withOrg(c.env, c.var.org, (tx) =>
        tx
          .insert(inboxReads)
          .values(
            keys.map((itemKey) => ({
              organizationId: c.var.org,
              userId,
              itemKey,
            })),
          )
          .onConflictDoNothing(),
      );
      return c.body(null, 204);
    },
  );
