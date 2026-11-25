// The inbox (design doc 06): cases waiting on the person's groups, mentions of
// their groups, cases assigned to them, approvals and memory rules (spec 10)
// they may decide, fields to review on cases they can work, and, for Owners and Admins, pending guardrail requests. Computed on read from
// membership, assignment and access. Read marks are kept per item key.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { withOrg } from "@preprocess/db/client";
import { agents, groupMembers, groups } from "@preprocess/db/schema/access";
import {
  caseApprovals,
  caseAssignees,
  caseMentions,
  cases,
  inboxReads,
} from "@preprocess/db/schema/cases";
import { guardrailRequests } from "@preprocess/db/schema/guardrails";
import { agentMemories } from "@preprocess/db/schema/memories";
import { and, desc, eq, inArray, isNotNull, ne, notInArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { mayApprove } from "../access.ts";
import type { Caller, OrgVariables } from "../caller.ts";
import type { Env } from "../env.ts";
import { Change } from "./guardrails.ts";

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
        '"waiting:<caseId>:<since>", "mention:<id>", "assigned:<caseId>:<at>", "approval:<approvalId>", "guardrail:<requestId>", "memory:<memoryId>" or "review:<caseId>:<since>"',
    }),
    kind: z.enum([
      "waiting",
      "mention",
      "assigned",
      "approval",
      "guardrail",
      "memory",
      "review",
    ]),
    at: z.string().datetime(),
    read: z.boolean(),
    case: z
      .object({
        id: z.string(),
        agent: z.object({ id: z.string(), slug: z.string() }),
        title: z.string().nullable(),
        status: z.string(),
      })
      .nullable()
      .openapi({ description: "Null for guardrail requests" }),
    group: z
      .object({ id: z.string(), slug: z.string(), name: z.string() })
      .nullable()
      .openapi({
        description:
          "The group waited on or mentioned, or the group named to approve (null: any operator)",
      }),
    message: z.string().nullable().openapi({
      description: "A mention's message, or a proposed memory rule's text",
    }),
    approval: z
      .object({
        id: z.string(),
        level: z.enum(["tool", "field", "completion"]),
        target: z.string().openapi({
          description: "The tool name or field path; empty for completion",
        }),
        payload: z.unknown(),
        reason: z.string().nullable(),
      })
      .nullable()
      .openapi({ description: 'What to approve; set when kind is "approval"' }),
    guardrail: z
      .object({
        id: z.string(),
        agent: z
          .object({ id: z.string(), slug: z.string() })
          .nullable()
          .openapi({ description: "Null when the request covers every agent" }),
        change: Change,
        reason: z.string().nullable(),
        requestedBy: z.object({ type: z.string(), id: z.string() }),
      })
      .nullable()
      .openapi({
        description: 'The loosening asked for; set when kind is "guardrail"',
      }),
    review: z
      .object({
        fields: z.array(z.string()).openapi({
          description: "Paths of visible fields waiting for a person's review",
        }),
      })
      .nullable()
      .openapi({ description: 'Set when kind is "review"' }),
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
      const caller = c.var.caller;
      const userId = person(caller);
      const decidesGuardrails =
        caller.role === "owner" || caller.role === "admin";
      const items = await withOrg(c.env, c.var.org, async (tx) => {
        const group = { id: groups.id, slug: groups.slug, name: groups.name };
        const [
          waiting,
          mentions,
          assigned,
          approvals,
          requests,
          proposals,
          reviews,
          reads,
        ] = await Promise.all([
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
          tx
            .select({
              ...caseColumns,
              approvalId: caseApprovals.id,
              level: caseApprovals.level,
              target: caseApprovals.target,
              payload: caseApprovals.payload,
              reason: caseApprovals.reason,
              at: caseApprovals.requestedAt,
              groupId: groups.id,
              groupSlug: groups.slug,
              groupName: groups.name,
            })
            .from(caseApprovals)
            .innerJoin(cases, eq(cases.id, caseApprovals.caseId))
            .innerJoin(agents, eq(agents.id, cases.agentId))
            .leftJoin(groups, eq(groups.id, caseApprovals.groupId))
            .where(eq(caseApprovals.status, "pending")),
          decidesGuardrails
            ? tx
                .select({
                  id: guardrailRequests.id,
                  agentId: guardrailRequests.agentId,
                  agentSlug: agents.slug,
                  change: guardrailRequests.change,
                  reason: guardrailRequests.reason,
                  requestedByType: guardrailRequests.requestedByType,
                  requestedBy: guardrailRequests.requestedBy,
                  at: guardrailRequests.createdAt,
                })
                .from(guardrailRequests)
                .leftJoin(agents, eq(agents.id, guardrailRequests.agentId))
                .where(eq(guardrailRequests.status, "pending"))
            : [],
          tx
            .select({
              ...caseColumns,
              memoryId: agentMemories.id,
              text: agentMemories.text,
              at: agentMemories.proposedAt,
            })
            .from(agentMemories)
            .innerJoin(cases, eq(cases.id, agentMemories.caseId))
            .innerJoin(agents, eq(agents.id, cases.agentId))
            .where(eq(agentMemories.status, "proposed")),
          tx
            .select({
              ...caseColumns,
              fields: cases.reviewFields,
              since: cases.reviewSince,
            })
            .from(cases)
            .innerJoin(agents, eq(agents.id, cases.agentId))
            .where(
              and(
                inArray(cases.status, ["waiting", "completed"]),
                isNotNull(cases.reviewSince),
              ),
            ),
          tx
            .select({ key: inboxReads.itemKey })
            .from(inboxReads)
            .where(eq(inboxReads.userId, userId)),
        ]);
        // mayApprove is the approval rule; ask it once per agent and group.
        const decides = new Map<string, Promise<boolean>>();
        const mayDecide = (agentId: string, slug: string | null) => {
          const key = `${agentId}:${slug ?? ""}`;
          if (!decides.has(key))
            decides.set(key, mayApprove(tx, caller, agentId, slug));
          return decides.get(key)!;
        };
        const allowed = await Promise.all(
          approvals.map((a) => mayDecide(a.agentId, a.groupSlug)),
        );
        // Any operator decides a memory rule, like an approval naming no group.
        const decidesMemory = await Promise.all(
          proposals.map((m) => mayDecide(m.agentId, null)),
        );
        // Reviewing a field is working the case: any operator of the agent.
        const reviewable = await Promise.all(
          reviews.map((r) => mayDecide(r.agentId, null)),
        );
        const read = new Set(reads.map((r) => r.key));
        const all: (Omit<Item, "read" | "review"> &
          Partial<Pick<Item, "review">>)[] = [
          ...waiting.map((w) => {
            const at = (w.since ?? new Date(0)).toISOString();
            return {
              key: `waiting:${w.id}:${at}`,
              kind: "waiting" as const,
              at,
              case: caseOf(w),
              group: w.group,
              message: null,
              approval: null,
              guardrail: null,
            };
          }),
          ...mentions.map((m) => ({
            key: `mention:${m.mentionId}`,
            kind: "mention" as const,
            at: m.at.toISOString(),
            case: caseOf(m),
            group: m.group,
            message: m.message,
            approval: null,
            guardrail: null,
          })),
          ...assigned.map((a) => ({
            key: `assigned:${a.id}:${a.at.toISOString()}`,
            kind: "assigned" as const,
            at: a.at.toISOString(),
            case: caseOf(a),
            group: null,
            message: null,
            approval: null,
            guardrail: null,
          })),
          ...approvals
            .filter((_, i) => allowed[i])
            .map((a) => ({
              key: `approval:${a.approvalId}`,
              kind: "approval" as const,
              at: a.at.toISOString(),
              case: caseOf(a),
              group:
                a.groupId && a.groupSlug && a.groupName
                  ? { id: a.groupId, slug: a.groupSlug, name: a.groupName }
                  : null,
              message: null,
              approval: {
                id: a.approvalId,
                level: a.level,
                target: a.target,
                payload: a.payload,
                reason: a.reason,
              },
              guardrail: null,
            })),
          ...requests.map((r) => ({
            key: `guardrail:${r.id}`,
            kind: "guardrail" as const,
            at: r.at.toISOString(),
            case: null,
            group: null,
            message: null,
            approval: null,
            guardrail: {
              id: r.id,
              agent:
                r.agentId && r.agentSlug
                  ? { id: r.agentId, slug: r.agentSlug }
                  : null,
              change: r.change,
              reason: r.reason,
              requestedBy: { type: r.requestedByType, id: r.requestedBy },
            },
          })),
          ...proposals
            .filter((_, i) => decidesMemory[i])
            .map((m) => ({
              key: `memory:${m.memoryId}`,
              kind: "memory" as const,
              at: m.at.toISOString(),
              case: caseOf(m),
              group: null,
              message: m.text,
              approval: null,
              guardrail: null,
            })),
          ...reviews
            .filter((r, i) => reviewable[i] && r.fields.length)
            .map((r) => {
              const at = r.since!.toISOString();
              return {
                key: `review:${r.id}:${at}`,
                kind: "review" as const,
                at,
                case: caseOf(r),
                group: null,
                message: null,
                approval: null,
                guardrail: null,
                review: { fields: r.fields },
              };
            }),
        ];
        return all
          .map((i) => ({ review: null, ...i, read: read.has(i.key) }))
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
