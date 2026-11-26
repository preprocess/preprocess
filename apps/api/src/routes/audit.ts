// The audit log (doc 02): list and verify are free and readable by Owners and
// Admins; export is paid, refused on the free plan, and for Owners only.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { readAuditEvents, toHex, verifyAuditChain } from "@preprocess/db/audit";
import type { AuditRow } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import { auditEvents } from "@preprocess/db/schema/audit";
import type { OrgId, Tx } from "@preprocess/db/client";
import { audit } from "@preprocess/db/audit";
import { and, asc, eq, gt, gte, lt } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { checkSignature, manifestKey } from "../audit-anchor.ts";
import type { AuditManifest } from "../audit-anchor.ts";
import { eventBase, requireAdmin } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import type { Env } from "../env.ts";
import { ApiError } from "../cases.ts";
import { getPlan } from "../plan.ts";

const OrgParam = z.object({ org: z.string() });

const AuditEvent = z
  .object({
    id: z.string(),
    seq: z.number(),
    occurredAt: z.string(),
    actorType: z.enum(["person", "agent", "api_key", "platform"]),
    actorId: z.string(),
    onBehalfOf: z.string().nullable(),
    action: z.string(),
    targetType: z.string().nullable(),
    targetId: z.string().nullable(),
    caseId: z.string().nullable(),
    requestId: z.string().nullable(),
    ip: z.string().nullable(),
    data: z.record(z.string(), z.unknown()),
    prevHash: z.string(),
    hash: z.string(),
  })
  .openapi("AuditEvent");

const Verification = z
  .object({
    ok: z.boolean(),
    checkedThroughSeq: z.number(),
    anchorsChecked: z.number(),
    firstBreak: z
      .object({
        seq: z.number(),
        reason: z.enum([
          "hash_mismatch",
          "gap",
          "anchor_mismatch",
          "anchor_missing",
        ]),
      })
      .optional(),
  })
  .openapi("AuditVerification");

type Filters = {
  action?: string | undefined;
  actor?: string | undefined;
  caseId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

// One page of events after a seq that match the filters, in ascending seq
// order, read through the chain reader so each carries its hashes.
const pageEvents = async (
  tx: Tx,
  org: OrgId,
  q: Filters & { after?: number | undefined; limit: number },
) => {
  const filtered = await tx
    .select({ seq: auditEvents.seq })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, org),
        q.after === undefined ? undefined : gt(auditEvents.seq, q.after),
        q.action ? eq(auditEvents.action, q.action) : undefined,
        q.actor ? eq(auditEvents.actorId, q.actor) : undefined,
        q.caseId ? eq(auditEvents.caseId, q.caseId) : undefined,
        q.from ? gte(auditEvents.occurredAt, new Date(q.from)) : undefined,
        q.to ? lt(auditEvents.occurredAt, new Date(q.to)) : undefined,
      ),
    )
    .orderBy(asc(auditEvents.seq))
    .limit(q.limit);
  if (filtered.length === 0) return [];
  const seqs = new Set(filtered.map((r) => r.seq));
  const page = await readAuditEvents(tx, org, {
    afterSeq: filtered[0]!.seq - 1,
    limit: filtered.at(-1)!.seq - filtered[0]!.seq + 1,
  });
  return page.filter((r) => seqs.has(r.seq));
};

// The longest range one export may cover.
export const EXPORT_MAX_DAYS = 90;
const EXPORT_PAGE = 500;

const COLUMNS = [
  "id",
  "seq",
  "occurredAt",
  "actorType",
  "actorId",
  "onBehalfOf",
  "action",
  "targetType",
  "targetId",
  "caseId",
  "requestId",
  "ip",
  "data",
  "prevHash",
  "hash",
] as const;

const csvCell = (value: unknown) => {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const FORMATS = {
  csv: {
    type: "text/csv; charset=utf-8",
    header: `${COLUMNS.join(",")}\r\n`,
    line: (e: ReturnType<typeof toEvent>) =>
      `${COLUMNS.map((c) => csvCell(e[c])).join(",")}\r\n`,
  },
  ndjson: {
    type: "application/x-ndjson",
    header: "",
    line: (e: ReturnType<typeof toEvent>) => `${JSON.stringify(e)}\n`,
  },
} as const;

const ExportRequest = z
  .object({
    format: z.enum(["csv", "ndjson"]).openapi({
      description: "csv (RFC 4180, a header row, data as JSON) or ndjson",
    }),
    from: z.string().datetime().openapi({ description: "Inclusive start" }),
    to: z.string().datetime().openapi({ description: "Exclusive end" }),
    action: z.string().optional(),
    actor: z.string().optional(),
    caseId: z.string().optional(),
  })
  .strict()
  .openapi("AuditExportRequest");

// Checked before the body, so a caller without the right or the plan learns
// that first.
const exportAllowed = createMiddleware<{
  Bindings: Env;
  Variables: OrgVariables;
}>(async (c, next) => {
  if (c.var.caller.role !== "owner")
    throw new HTTPException(403, {
      message: "Only Owners can export the audit log.",
    });
  (await getPlan(c.env, c.var.org)).assert("audit_export");
  await next();
});

const toEvent = (row: AuditRow) => ({
  ...row,
  data: row.data as Record<string, unknown>,
  prevHash: toHex(row.prevHash),
  hash: toHex(row.hash),
});

export const auditRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/audit-events",
      tags: ["Audit"],
      request: {
        params: OrgParam,
        query: z.object({
          after: z.coerce.number().int().min(0).optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
          action: z.string().optional(),
          actor: z.string().optional(),
          caseId: z.string().optional(),
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({
                events: z.array(AuditEvent),
                next: z.number().nullable(),
              }),
            },
          },
          description: "Events in ascending seq order; pass next as after",
        },
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const q = c.req.valid("query");
      const org = c.var.org;
      const rows = await withOrg(c.env, org, (tx) => pageEvents(tx, org, q));
      return c.json(
        {
          events: rows.map(toEvent),
          next: rows.length === q.limit ? rows.at(-1)!.seq : null,
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/audit-events/verify",
      tags: ["Audit"],
      request: { params: OrgParam },
      responses: {
        200: {
          content: { "application/json": { schema: Verification } },
          description: "Whether the chain and its signed daily copies agree",
        },
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const org = c.var.org;
      // Walk the whole chain, then check each signed daily manifest against it.
      const { chain, heads } = await withOrg(c.env, org, async (tx) => {
        const chain = await verifyAuditChain(tx, org);
        const heads = new Map<number, string>();
        let after = 0;
        for (;;) {
          const page = await readAuditEvents(tx, org, { afterSeq: after });
          for (const row of page) heads.set(row.seq, toHex(row.hash));
          if (page.length < 1000) break;
          after = page.at(-1)!.seq;
        }
        return { chain, heads };
      });
      if (!chain.ok)
        return c.json(
          { ...chain, headHash: undefined, anchorsChecked: 0 },
          200,
        );

      const days: string[] = [];
      let cursor: string | undefined;
      do {
        const listed = await c.env.AUDIT.list({
          prefix: `audit/${org}/`,
          ...(cursor ? { cursor } : {}),
        });
        for (const object of listed.objects)
          if (object.key.endsWith("/manifest.json"))
            days.push(object.key.split("/").slice(2, 5).join("-"));
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
      days.sort();

      let anchorsChecked = 0;
      let previous: string | null = null;
      for (const day of days) {
        const manifest = await (
          await c.env.AUDIT.get(manifestKey(org, day))
        )?.json<AuditManifest>();
        const expected =
          manifest && manifest.lastSeq === 0
            ? "0".repeat(64)
            : manifest && heads.get(manifest.lastSeq);
        const contiguous =
          previous === null ||
          new Date(`${day}T00:00:00Z`).getTime() -
            new Date(`${previous}T00:00:00Z`).getTime() ===
            86_400_000;
        if (!manifest || !contiguous)
          return c.json(
            {
              ok: false,
              checkedThroughSeq: chain.checkedThroughSeq,
              anchorsChecked,
              firstBreak: {
                seq: manifest?.firstSeq ?? 0,
                reason: "anchor_missing" as const,
              },
            },
            200,
          );
        if (
          !(await checkSignature(c.env, manifest)) ||
          expected !== manifest.headHash
        )
          return c.json(
            {
              ok: false,
              checkedThroughSeq: chain.checkedThroughSeq,
              anchorsChecked,
              firstBreak: {
                seq: manifest.lastSeq,
                reason: "anchor_mismatch" as const,
              },
            },
            200,
          );
        anchorsChecked++;
        previous = day;
      }
      return c.json(
        {
          ok: true,
          checkedThroughSeq: chain.checkedThroughSeq,
          anchorsChecked,
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/audit-events/{id}",
      tags: ["Audit"],
      request: { params: OrgParam.extend({ id: z.string() }) },
      responses: {
        200: {
          content: { "application/json": { schema: AuditEvent } },
          description: "One event",
        },
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const org = c.var.org;
      const id = c.req.valid("param").id;
      const row = await withOrg(c.env, org, async (tx) => {
        const [found] = await tx
          .select({ seq: auditEvents.seq })
          .from(auditEvents)
          .where(eq(auditEvents.id, id));
        if (!found) return null;
        const [event] = await readAuditEvents(tx, org, {
          afterSeq: found.seq - 1,
          limit: 1,
        });
        return event ?? null;
      });
      if (!row) throw new HTTPException(404, { message: "No such event." });
      return c.json(toEvent(row), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/audit-events/export",
      tags: ["Audit"],
      summary: `Export events in a date range of up to ${EXPORT_MAX_DAYS} days as CSV or NDJSON (Owners only, paid plans)`,
      description:
        "The file streams in ascending seq order with each event's hashes, so it can be checked against the chain. The export itself is recorded as audit.exported.",
      middleware: [exportAllowed] as const,
      request: {
        params: OrgParam,
        body: {
          content: { "application/json": { schema: ExportRequest } },
          required: true,
        },
      },
      responses: {
        200: {
          content: {
            "text/csv": { schema: z.string() },
            "application/x-ndjson": { schema: z.string() },
          },
          description: "The events, streamed as an attachment",
        },
        400: {
          description: `An invalid body, or a range that is empty or longer than ${EXPORT_MAX_DAYS} days`,
        },
        403: {
          description:
            "Not an Owner, or the plan does not include audit export",
        },
      },
    }),
    async (c) => {
      const input = c.req.valid("json");
      const org = c.var.org;
      const from = new Date(input.from);
      const to = new Date(input.to);
      if (to <= from)
        throw new ApiError(400, "invalid_range", "to must be after from.");
      if (to.getTime() - from.getTime() > EXPORT_MAX_DAYS * 86_400_000)
        throw new ApiError(
          400,
          "range_too_long",
          `Export at most ${EXPORT_MAX_DAYS} days at a time.`,
        );
      await withOrg(c.env, org, (tx) =>
        audit(tx, {
          ...eventBase(c.var),
          action: "audit.exported",
          targetType: "organization",
          targetId: org,
          data: {
            format: input.format,
            from: input.from,
            to: input.to,
            filters: {
              action: input.action ?? null,
              actor: input.actor ?? null,
              caseId: input.caseId ?? null,
            },
          },
        }),
      );
      const format = FORMATS[input.format];
      const encoder = new TextEncoder();
      // Pages are written as the client reads them: each write waits until
      // the previous chunk was taken, so at most a page is held in memory.
      const { readable, writable } = new TransformStream<
        Uint8Array,
        Uint8Array
      >();
      const writer = writable.getWriter();
      void (async () => {
        try {
          if (format.header) await writer.write(encoder.encode(format.header));
          let after: number | undefined;
          for (;;) {
            const page = await withOrg(c.env, org, (tx) =>
              pageEvents(tx, org, { ...input, after, limit: EXPORT_PAGE }),
            );
            if (page.length)
              await writer.write(
                encoder.encode(
                  page.map((r) => format.line(toEvent(r))).join(""),
                ),
              );
            if (page.length < EXPORT_PAGE) break;
            after = page.at(-1)!.seq;
          }
          await writer.close();
        } catch (error) {
          await writer.abort(error);
        }
      })();
      const name = `audit-events-${input.from.slice(0, 10)}-${input.to.slice(0, 10)}.${input.format}`;
      return new Response(readable, {
        status: 200,
        headers: {
          "content-type": format.type,
          "content-disposition": `attachment; filename="${name}"`,
          "cache-control": "no-store",
        },
      });
    },
  );
