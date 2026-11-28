// Datasets (design doc 10): saved queries over one agent's closed cases,
// previewed and exported as sft, preference or replay NDJSON. Anyone who can
// see the agent's cases reads them; Developers, Admins, Owners and API keys
// create, change, delete and export them. Training's switch is not read.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { cases, caseSearch, reviewEvents } from "@preprocess/db/schema/cases";
import { datasets } from "@preprocess/db/schema/datasets";
import { user } from "@preprocess/db/schema/auth";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import { agentRole, canSeeCase } from "../access.ts";
import { eventBase, requireDeveloper } from "../caller.ts";
import type { Caller, OrgVariables } from "../caller.ts";
import {
  CLOSED,
  closedCases,
  countClosedCases,
  EXPORT_LIMIT_MAX,
  exportable,
  exportPage,
  reviewEventsOf,
  streamExport,
} from "../capture.ts";
import { ApiError, findAgent } from "../cases.ts";
import {
  datasetFilter,
  DEFAULT_QUERY,
  EDIT,
  edited,
  editedFields,
  FORMATS,
} from "../datasets.ts";
import type { Env } from "../env.ts";
import { ndjson } from "./capture.ts";

const OrgParam = z.object({ org: z.string() });
const AgentParam = OrgParam.extend({ agent: z.string() });
const DatasetParam = AgentParam.extend({ dataset: z.string() });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});

const ErrorBody = z
  .object({ error: z.object({ code: z.string(), message: z.string() }) })
  .openapi("Error");
const error = (description: string) => json(ErrorBody, description);

const Query = z
  .object({
    period: z.enum(["7d", "30d", "90d", "all"]).optional().openapi({
      description:
        "A rolling window ending now, in place of from and to; all is every case",
    }),
    from: z.string().datetime().optional().openapi({
      description: "Cases created at or after this time",
    }),
    to: z.string().datetime().optional().openapi({
      description: "Cases created before this time",
    }),
    status: z.array(z.enum(CLOSED)).min(1).optional(),
    deployments: z.array(z.string()).min(1).max(100).optional(),
    edited: z
      .union([
        z.object({ any: z.literal(true) }).strict(),
        z
          .object({ fields: z.array(z.string().min(1)).min(1).max(100) })
          .strict(),
        z.object({ none: z.literal(true) }).strict(),
      ])
      .optional()
      .openapi({
        description:
          "Cases a person edited at all, edited one of these fields, or did not edit",
      }),
    outcome: z.enum(["corrected", "accepted"]).optional().openapi({
      description:
        "corrected: a person edited at least one field; accepted: completed with no edit",
    }),
  })
  .strict()
  .refine((q) => !q.period || (!q.from && !q.to), {
    message: "Give a period or from and to, not both.",
  })
  .openapi("DatasetQuery", {
    description: "Which of the agent's closed cases the dataset holds",
  });

// A query passed as a JSON string in a URL, checked like a saved one.
const DraftQuery = z
  .string()
  .transform((text, ctx) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "query is not valid JSON." });
      return z.NEVER;
    }
  })
  .pipe(Query);

const Dataset = z
  .object({
    id: z.string(),
    agentId: z.string(),
    name: z.string(),
    query: Query,
    count: z.number().openapi({
      description: "The closed cases the query selects now",
    }),
    createdBy: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    updatedBy: z.object({
      id: z.string().openapi({ description: "A user id, or an API key's id" }),
      name: z.string().nullable(),
    }),
  })
  .openapi("Dataset");

const Name = z.string().trim().min(1).max(100);

// The datasets as the API shows them: each with its current count and who
// changed it last.
const views = async (
  tx: Tx,
  rows: (typeof datasets.$inferSelect)[],
): Promise<z.infer<typeof Dataset>[]> => {
  const ids = [...new Set(rows.map((r) => r.updatedBy))];
  const names = new Map(
    (ids.length
      ? await tx
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, ids))
      : []
    ).map((u) => [u.id, u.name]),
  );
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      agentId: row.agentId,
      name: row.name,
      query: row.query,
      count: await countClosedCases(tx, row.agentId, datasetFilter(row.query)),
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: { id: row.updatedBy, name: names.get(row.updatedBy) ?? null },
    })),
  );
};
const view = async (tx: Tx, row: typeof datasets.$inferSelect) =>
  (await views(tx, [row]))[0]!;

const creator = (caller: Caller) =>
  caller.type === "person" ? caller.userId : caller.keyId;

// The agent, if the caller may see its cases; writing also needs a Developer.
const agentFor = async (
  tx: Tx,
  caller: Caller,
  ref: string,
  write: boolean,
) => {
  if (write) await requireDeveloper(tx, caller);
  const agent = await findAgent(tx, ref);
  if (!agent || !canSeeCase(caller, await agentRole(tx, caller, agent.id)))
    throw new ApiError(404, "not_found", "No such agent.");
  return agent;
};

const findDataset = async (tx: Tx, agentId: string, id: string) => {
  const [row] = await tx
    .select()
    .from(datasets)
    .where(and(eq(datasets.agentId, agentId), eq(datasets.id, id)));
  if (!row) throw new ApiError(404, "not_found", "No such dataset.");
  return row;
};

const nameTaken = async (tx: Tx, agentId: string, name: string) => {
  const [row] = await tx
    .select({ id: datasets.id })
    .from(datasets)
    .where(and(eq(datasets.agentId, agentId), eq(datasets.name, name)));
  return row?.id;
};

const refuseTakenName = () => {
  throw new ApiError(
    409,
    "dataset_name_taken",
    "This agent already has a dataset with that name.",
  );
};

export const datasetRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/agents/{agent}/answer-fields",
      tags: ["Training"],
      summary: "The answer fields the agent's cases hold and people edited",
      description:
        "Top-level answer fields of the agent's completed cases and every field path a person edited, sorted, at most 200: the choices for a dataset's edited fields.",
      request: { params: AgentParam },
      responses: {
        200: json(z.object({ fields: z.array(z.string()) }), "The fields"),
        404: error("No such agent"),
      },
    }),
    async (c) => {
      const { agent: ref } = c.req.valid("param");
      const fields = await withOrg(c.env, c.var.org, async (tx) => {
        const agent = await agentFor(tx, c.var.caller, ref, false);
        const rows = await tx.execute<{ field: string }>(sql`
          select field from (
            select jsonb_object_keys(${caseSearch.answers}) as field
            from ${caseSearch}
            where ${caseSearch.agentId} = ${agent.id} and jsonb_typeof(${caseSearch.answers}) = 'object'
            union
            select ${reviewEvents.path} as field
            from ${reviewEvents} join ${cases} on ${cases.id} = ${reviewEvents.caseId}
            where ${cases.agentId} = ${agent.id} and ${reviewEvents.kind} = ${EDIT} and ${reviewEvents.path} is not null
          ) f order by field limit 200`);
        return rows.rows.map((r) => r.field);
      });
      return c.json({ fields }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/agents/{agent}/datasets",
      tags: ["Training"],
      summary: "An agent's datasets",
      request: { params: AgentParam },
      responses: {
        200: json(z.object({ items: z.array(Dataset) }), "The datasets"),
        404: error("No such agent"),
      },
    }),
    async (c) => {
      const { agent: ref } = c.req.valid("param");
      const items = await withOrg(c.env, c.var.org, async (tx) => {
        const agent = await agentFor(tx, c.var.caller, ref, false);
        return views(
          tx,
          await tx
            .select()
            .from(datasets)
            .where(eq(datasets.agentId, agent.id))
            .orderBy(asc(datasets.name)),
        );
      });
      return c.json({ items }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/agents/{agent}/datasets",
      tags: ["Training"],
      summary:
        "Save a query over the agent's cases as a dataset (Developers, Admins, API keys)",
      request: {
        params: AgentParam,
        ...body(
          z
            .object({
              name: Name,
              query: Query.optional().openapi({
                description:
                  "Default: the last 30 days, completed, every deployment, edited or not, either outcome",
              }),
            })
            .strict(),
        ),
      },
      responses: {
        201: json(Dataset, "The dataset"),
        403: error("Not a Developer, Admin or Owner"),
        404: error("No such agent"),
        409: error("The name is taken (dataset_name_taken)"),
      },
    }),
    async (c) => {
      const { agent: ref } = c.req.valid("param");
      const input = c.req.valid("json");
      const row = await withOrg(c.env, c.var.org, async (tx) => {
        const agent = await agentFor(tx, c.var.caller, ref, true);
        if (await nameTaken(tx, agent.id, input.name)) refuseTakenName();
        const [row] = await tx
          .insert(datasets)
          .values({
            id: newId("dataset"),
            organizationId: c.var.org,
            agentId: agent.id,
            name: input.name,
            query: input.query ?? DEFAULT_QUERY,
            createdBy: creator(c.var.caller),
            updatedBy: creator(c.var.caller),
          })
          .returning();
        await audit(tx, {
          ...eventBase(c.var),
          action: "dataset.created",
          targetType: "dataset",
          targetId: row!.id,
          data: { agent: agent.id, name: input.name },
        });
        return view(tx, row!);
      });
      return c.json(row, 201);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/agents/{agent}/datasets/{dataset}",
      tags: ["Training"],
      summary: "A dataset",
      request: { params: DatasetParam },
      responses: {
        200: json(Dataset, "The dataset"),
        404: error("No such agent or dataset"),
      },
    }),
    async (c) => {
      const { agent: ref, dataset: id } = c.req.valid("param");
      const row = await withOrg(c.env, c.var.org, async (tx) =>
        view(
          tx,
          await findDataset(
            tx,
            (await agentFor(tx, c.var.caller, ref, false)).id,
            id,
          ),
        ),
      );
      return c.json(row, 200);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/agents/{agent}/datasets/{dataset}",
      tags: ["Training"],
      summary:
        "Rename a dataset or change its query (Developers, Admins, API keys)",
      request: {
        params: DatasetParam,
        ...body(
          z.object({ name: Name.optional(), query: Query.optional() }).strict(),
        ),
      },
      responses: {
        200: json(Dataset, "The dataset"),
        403: error("Not a Developer, Admin or Owner"),
        404: error("No such agent or dataset"),
        409: error("The name is taken (dataset_name_taken)"),
      },
    }),
    async (c) => {
      const { agent: ref, dataset: id } = c.req.valid("param");
      const input = c.req.valid("json");
      const row = await withOrg(c.env, c.var.org, async (tx) => {
        const agent = await agentFor(tx, c.var.caller, ref, true);
        await findDataset(tx, agent.id, id);
        if (input.name !== undefined) {
          const holder = await nameTaken(tx, agent.id, input.name);
          if (holder && holder !== id) refuseTakenName();
        }
        const [row] = await tx
          .update(datasets)
          .set({
            ...input,
            updatedBy: creator(c.var.caller),
            updatedAt: new Date(),
          })
          .where(eq(datasets.id, id))
          .returning();
        await audit(tx, {
          ...eventBase(c.var),
          action: "dataset.updated",
          targetType: "dataset",
          targetId: id,
          data: {
            agent: agent.id,
            name: row!.name,
            changed: Object.keys(input),
          },
        });
        return view(tx, row!);
      });
      return c.json(row, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/agents/{agent}/datasets/{dataset}",
      tags: ["Training"],
      summary:
        "Delete a dataset (Developers, Admins, API keys); its cases stay",
      request: { params: DatasetParam },
      responses: {
        204: { description: "Deleted" },
        403: error("Not a Developer, Admin or Owner"),
        404: error("No such agent or dataset"),
      },
    }),
    async (c) => {
      const { agent: ref, dataset: id } = c.req.valid("param");
      await withOrg(c.env, c.var.org, async (tx) => {
        const agent = await agentFor(tx, c.var.caller, ref, true);
        const row = await findDataset(tx, agent.id, id);
        await tx.delete(datasets).where(eq(datasets.id, id));
        await audit(tx, {
          ...eventBase(c.var),
          action: "dataset.deleted",
          targetType: "dataset",
          targetId: id,
          data: { agent: agent.id, name: row.name },
        });
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/agents/{agent}/datasets/{dataset}/preview",
      tags: ["Training"],
      summary: "How many cases a dataset holds, and the newest of them",
      request: {
        params: DatasetParam,
        query: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(20),
          query: DraftQuery.optional().openapi({
            description:
              "An unsaved query, as JSON, to preview in place of the saved one",
            example: '{"period":"30d","status":["completed"]}',
          }),
        }),
      },
      responses: {
        200: json(
          z.object({
            count: z.number(),
            cases: z.array(
              z.object({
                id: z.string(),
                title: z.string().nullable(),
                status: z.enum(CLOSED),
                completedAt: z.string().nullable(),
                editedFields: z.array(z.string()),
              }),
            ),
          }),
          "The count and the newest cases",
        ),
        400: { description: "A query that is not a dataset query as JSON" },
        404: error("No such agent or dataset"),
      },
    }),
    async (c) => {
      const { agent: ref, dataset: id } = c.req.valid("param");
      const { limit, query: draft } = c.req.valid("query");
      const preview = await withOrg(c.env, c.var.org, async (tx) => {
        const agent = await agentFor(tx, c.var.caller, ref, false);
        const dataset = await findDataset(tx, agent.id, id);
        const where = closedCases(
          agent.id,
          datasetFilter(draft ?? dataset.query),
        );
        const [total] = await tx
          .select({ n: count() })
          .from(cases)
          .where(where);
        const rows = await tx
          .select({
            id: cases.id,
            title: cases.title,
            status: cases.status,
            completedAt: cases.completedAt,
          })
          .from(cases)
          .where(where)
          .orderBy(desc(cases.createdAt), desc(cases.id))
          .limit(limit);
        const events = await reviewEventsOf(
          tx,
          rows.map((r) => r.id),
        );
        return {
          count: total?.n ?? 0,
          cases: rows.map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status as (typeof CLOSED)[number],
            completedAt: r.completedAt?.toISOString() ?? null,
            editedFields: editedFields(events.get(r.id) ?? []),
          })),
        };
      });
      return c.json(preview, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/agents/{agent}/datasets/{dataset}/export",
      tags: ["Training"],
      summary:
        "Export a dataset's cases as sft, preference or replay NDJSON (Developers, Admins, API keys)",
      description:
        'Paged like the capture export: one line per case, oldest first, then { "next": cursor or null, "skipped": n }, where skipped counts the cases of the page left out: their capture was purged or holds no conversation to export. The count in the preview is all lines and skipped cases of every page together, except for preference, which holds only cases with an edit. sft: { case, messages }, the model conversation with every answer a person corrected carrying their value. preference: { case, prompt, chosen, rejected } for cases with an edit, the conversation up to the agent\'s first answer and the corrected and original continuations. replay: { case, capture, reviewEvents }. Each export is recorded as dataset.exported.',
      request: {
        params: DatasetParam,
        query: z.object({
          format: z.enum(["sft", "preference", "replay"]),
          cursor: z.string().optional().openapi({
            description: "The next cursor from the previous page's trailer",
          }),
          limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(EXPORT_LIMIT_MAX)
            .default(100),
        }),
      },
      responses: {
        200: ndjson("The lines, streamed as an attachment"),
        400: { description: "A bad cursor or format" },
        403: { description: "Not a Developer, Admin or Owner" },
        404: { description: "No such agent or dataset" },
      },
    }),
    async (c) => {
      const { agent: ref, dataset: id } = c.req.valid("param");
      const query = c.req.valid("query");
      const { dataset, page } = await withOrg(c.env, c.var.org, async (tx) => {
        const agent = await agentFor(tx, c.var.caller, ref, true);
        const dataset = await findDataset(tx, agent.id, id);
        const filter = datasetFilter(dataset.query);
        if (query.format === "preference")
          filter.where = [...(filter.where ?? []), edited()];
        const page = await exportable(
          tx,
          await exportPage(tx, agent.id, filter, query),
        );
        await audit(tx, {
          ...eventBase(c.var),
          action: "dataset.exported",
          targetType: "dataset",
          targetId: dataset.id,
          data: {
            agent: agent.id,
            format: query.format,
            cursor: query.cursor ?? null,
            limit: query.limit,
            count: page.kept.length,
            skipped: page.skipped,
          },
        });
        return { dataset, page };
      });
      return streamExport(
        c.env,
        c.var.org,
        page,
        FORMATS[query.format],
        `dataset-${dataset.id}-${query.format}.ndjson`,
      );
    },
  );
