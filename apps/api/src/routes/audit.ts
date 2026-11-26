// The audit log (doc 02): list and verify are free and readable by Owners and
// Admins; export is paid and refused on the free plan.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { readAuditEvents, toHex, verifyAuditChain } from "@preprocess/db/audit";
import type { AuditRow } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import { auditEvents } from "@preprocess/db/schema/audit";
import { and, asc, eq, gt, gte, lt } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { checkSignature, manifestKey } from "../audit-anchor.ts";
import type { AuditManifest } from "../audit-anchor.ts";
import { requireAdmin } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import type { Env } from "../env.ts";
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
      const rows = await withOrg(c.env, org, async (tx) => {
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
              q.from
                ? gte(auditEvents.occurredAt, new Date(q.from))
                : undefined,
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
      });
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
      request: { params: OrgParam },
      responses: { 403: { description: "Export is a paid feature" } },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      (await getPlan(c.env, c.var.org)).assert("audit_export");
      throw new HTTPException(501);
    },
  );
