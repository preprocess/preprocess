// The organization's OpenTelemetry export (design doc 09): Owners and Admins
// set an OTLP/HTTP endpoint, its headers and a switch. Header values are
// write-only: stored under the organization's key and never returned.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import { otelExports } from "@preprocess/db/schema/otel";

import { actor, eventBase, requireAdmin } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import { decrypt, encrypt, orgKey, orgKeyVersion } from "../crypto.ts";
import type { Env } from "../env.ts";
import { exportableEndpoint, headersAad } from "../otel.ts";

const OrgParam = z.object({ org: z.string() });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const HeaderName = z.string().regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/);

const Input = z
  .object({
    endpoint: z
      .string()
      .url()
      .refine(exportableEndpoint, "must be a public https URL")
      .openapi({
        description:
          "OTLP/HTTP base URL; logs go to {endpoint}/v1/logs and traces to {endpoint}/v1/traces",
      }),
    headers: z.record(HeaderName, z.string()).optional().openapi({
      description:
        "Headers sent with every export, such as the collector's API key. Replaces the stored headers; omit to keep them.",
    }),
    enabled: z.boolean().optional(),
  })
  .strict()
  .openapi("OtelExportInput");

const Export = z
  .object({
    endpoint: z.string(),
    headers: z.array(z.string()).openapi({
      description: "The stored header names; values are write-only",
    }),
    enabled: z.boolean(),
    updatedBy: z.string(),
    updatedAt: z.string(),
  })
  .openapi("OtelExport");

const shape = (row: typeof otelExports.$inferSelect) => ({
  endpoint: row.endpoint,
  headers: row.headerNames,
  enabled: row.enabled,
  updatedBy: row.updatedBy,
  updatedAt: row.updatedAt.toISOString(),
});

export const otelRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/settings/otel",
      tags: ["Settings"],
      summary: "The organization's OpenTelemetry export (Owner or Admin)",
      request: { params: OrgParam },
      responses: {
        200: json(Export, "The export"),
        404: { description: "Export is not set up" },
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const [row] = await withOrg(c.env, c.var.org, (tx) =>
        tx.select().from(otelExports),
      );
      if (!row) throw new ApiError(404, "not_found", "Export is not set up.");
      return c.json(shape(row), 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/settings/otel",
      tags: ["Settings"],
      summary: "Set the organization's OpenTelemetry export (Owner or Admin)",
      request: {
        params: OrgParam,
        body: {
          content: { "application/json": { schema: Input } },
          required: true,
        },
      },
      responses: { 200: json(Export, "The export") },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const input = c.req.valid("json");
      const org = c.var.org;
      const row = await withOrg(c.env, org, async (tx) => {
        const [existing] = await tx.select().from(otelExports).for("update");
        let headers = input.headers;
        if (!headers && existing) {
          const key = await orgKeyVersion(c.env, tx, org, existing.keyVersion);
          headers = JSON.parse(
            await decrypt(key, existing.headersCiphertext, headersAad(org)),
          ) as Record<string, string>;
        }
        const { version: keyVersion, key } = await orgKey(c.env, tx, org);
        const values = {
          endpoint: input.endpoint,
          headerNames: Object.keys(headers ?? {}).sort(),
          keyVersion,
          headersCiphertext: await encrypt(
            key,
            JSON.stringify(headers ?? {}),
            headersAad(org),
          ),
          enabled: input.enabled ?? existing?.enabled ?? true,
          updatedBy: actor(c.var.caller).actorId,
          updatedAt: new Date(),
        };
        const [saved] = await tx
          .insert(otelExports)
          .values({ organizationId: org, ...values })
          .onConflictDoUpdate({
            target: otelExports.organizationId,
            set: values,
          })
          .returning();
        await audit(tx, {
          ...eventBase(c.var),
          action: existing ? "otel_export.updated" : "otel_export.created",
          targetType: "otel_export",
          targetId: org,
          data: {
            endpoint: saved!.endpoint,
            headers: saved!.headerNames,
            headersChanged: input.headers !== undefined,
            enabled: saved!.enabled,
          },
        });
        return saved!;
      });
      return c.json(shape(row), 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/settings/otel",
      tags: ["Settings"],
      summary:
        "Remove the organization's OpenTelemetry export (Owner or Admin)",
      request: { params: OrgParam },
      responses: {
        204: { description: "Removed" },
        404: { description: "Export is not set up" },
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      await withOrg(c.env, c.var.org, async (tx) => {
        const [row] = await tx.delete(otelExports).returning();
        if (!row) throw new ApiError(404, "not_found", "Export is not set up.");
        await audit(tx, {
          ...eventBase(c.var),
          action: "otel_export.deleted",
          targetType: "otel_export",
          targetId: c.var.org,
          data: { endpoint: row.endpoint },
        });
      });
      return c.body(null, 204);
    },
  );
