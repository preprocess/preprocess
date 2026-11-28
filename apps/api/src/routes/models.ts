// The model catalogue and the organization's registered endpoints (design doc
// 10, section 4). Any member reads the catalogue; only an Owner or Admin
// registers, changes, tests or deletes an endpoint, since an endpoint is where
// case data is sent. Keys are write-only: responses carry hasKey, never the
// key, and audit events never hold it.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg, type Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { modelEndpoints } from "@preprocess/db/schema/models";
import { ROUTES } from "@preprocess/models/endpoints";
import { runMode } from "@preprocess/runmode";
import {
  currentModel,
  DEFAULT_MODEL,
  isOrgModel,
  MODEL_CATALOG,
  MODELS,
  type Model,
} from "@preprocess/sdk/protocol";
import { eq } from "drizzle-orm";

import { allowedModels, modelAllowed } from "../allowed-models.ts";
import {
  actor,
  eventBase,
  requireAdmin,
  type OrgVariables,
} from "../caller.ts";
import { ApiError } from "../cases.ts";
import type { Env } from "../env.ts";
import { organizationDefaultValues } from "../settings.ts";
import {
  installEndpoints,
  openKey,
  sealKey,
  type ModelEndpointRow,
} from "../model-endpoints.ts";

const OrgParam = z.object({ org: z.string() });
const EndpointParam = OrgParam.extend({ id: z.string() });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

// An OpenAI-compatible server's base URL: https, no credentials, query or
// fragment, and no path beyond /v1, since requests go to /v1/chat/completions
// on it.
const Url = z
  .string()
  .max(2048)
  .transform((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "not a URL" });
      return z.NEVER;
    }
    const path = url.pathname.replace(/\/+$/, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (path !== "" && path !== "/v1")
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "an https base URL like https://models.example.com or https://models.example.com/v1",
      });
      return z.NEVER;
    }
    return `${url.origin}${path}`;
  })
  .openapi({
    type: "string",
    description:
      "The OpenAI-compatible server's https base URL; requests go to /v1/chat/completions on it",
  });

const Key = z.string().min(1).max(5120).openapi({
  description: "The API key sent as a bearer token. Write-only",
});

const Endpoint = z
  .object({
    id: z.string(),
    model: z.string(),
    kind: z.enum(["override", "model"]),
    label: z.string().nullable(),
    baseModel: z.string().nullable(),
    host: z.string().openapi({
      description:
        "The endpoint's host; the full URL and the key are never returned",
    }),
    providerModel: z.string(),
    checkpoint: z.string().nullable(),
    hasKey: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("ModelEndpoint");

const CatalogModel = z
  .object({
    id: z.string(),
    label: z.string(),
    kind: z.literal("catalog"),
    serving: z.enum(["hosted", "endpoint", "install"]).openapi({
      description:
        "Who serves it: the platform (hosted), the organization's endpoint, or the install's own MODEL_ENDPOINTS entry",
    }),
    allowed: z.boolean(),
    isDefault: z.boolean().openapi({
      description:
        "The model agents run on when nothing else names one: the organization default, else the platform's",
    }),
    trainable: z.boolean(),
    canOverride: z.boolean().openapi({
      description:
        "Whether an Owner or Admin may serve it from the organization's own endpoint (POST /models/endpoints): only on a self-hosted install",
    }),
    endpoint: Endpoint.nullable(),
  })
  .openapi("CatalogModel");

const OrgModel = z
  .object({
    id: z.string(),
    kind: z.literal("model"),
    label: z.string(),
    baseModel: z.string().nullable(),
    checkpoint: z.string().nullable(),
    serving: z.literal("endpoint"),
    allowed: z.boolean(),
    isDefault: z.boolean(),
    endpoint: Endpoint,
  })
  .openapi("OrgModel");

const toEndpoint = (row: ModelEndpointRow): z.infer<typeof Endpoint> => ({
  id: row.id,
  model: row.model,
  kind: row.kind,
  label: row.label,
  baseModel: row.baseModel,
  host: new URL(row.url).host,
  providerModel: row.providerModel,
  checkpoint: row.checkpoint,
  hasKey: row.keyCiphertext !== null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const BaseModel = z.enum(MODELS).nullable().openapi({
  description:
    "The catalogue model an organization model was trained from, which prices it",
});

const Register = z.object({
  model: z.string().openapi({
    description:
      'A catalogue model id to serve it from this endpoint, or "org:<slug>" for a new organization model',
  }),
  url: Url,
  providerModel: z.string().min(1).max(256).optional().openapi({
    description:
      'The name sent as "model". Defaults to the provider\'s own name for a catalogue model; required for an organization model',
  }),
  key: Key.optional(),
  label: z.string().min(1).max(100).optional(),
  baseModel: BaseModel.optional(),
  checkpoint: z.string().max(500).nullable().optional(),
});

const Change = z.object({
  url: Url.optional(),
  providerModel: z.string().min(1).max(256).optional(),
  key: Key.nullable().optional().openapi({
    description: "A new key, or null to send none",
  }),
  label: z.string().min(1).max(100).optional(),
  baseModel: BaseModel.optional(),
  checkpoint: z.string().max(500).nullable().optional(),
});

const invalid = (message: string) => {
  throw new ApiError(400, "invalid_request", message);
};

const findEndpoint = async (tx: Tx, id: string) => {
  const [row] = await tx
    .select()
    .from(modelEndpoints)
    .where(eq(modelEndpoints.id, id))
    .for("update");
  if (!row) throw new ApiError(404, "not_found", "No such model endpoint.");
  return row;
};

// What an audit event says about an endpoint: never its key.
const described = (row: ModelEndpointRow) => ({
  model: row.model,
  kind: row.kind,
  host: new URL(row.url).host,
  providerModel: row.providerModel,
  hasKey: row.keyCiphertext !== null,
});

const TEST_TIMEOUT_MS = 15_000;

export const modelRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/models",
      tags: ["Models"],
      summary:
        "Every catalogue model and every organization model, with where each is served",
      request: { params: OrgParam },
      responses: {
        200: json(
          z.array(z.union([CatalogModel, OrgModel])),
          "Catalogue models first, then organization models; keys are never returned",
        ),
      },
    }),
    async (c) => {
      const { rows, allowed, defaults } = await withOrg(
        c.env,
        c.var.org,
        async (tx) => ({
          rows: await tx
            .select()
            .from(modelEndpoints)
            .orderBy(modelEndpoints.model),
          allowed: await allowedModels(tx),
          defaults: await organizationDefaultValues(tx),
        }),
      );
      const defaultModel =
        typeof defaults.model === "string"
          ? currentModel(defaults.model)
          : DEFAULT_MODEL;
      const install = installEndpoints(c.env);
      const canOverride = runMode(c.env).kind !== "cloud";
      const catalog = MODELS.map((id) => {
        const row = rows.find((r) => r.model === id);
        return {
          id,
          label: MODEL_CATALOG[id].label,
          kind: "catalog" as const,
          serving: row
            ? ("endpoint" as const)
            : install.has(id)
              ? ("install" as const)
              : ("hosted" as const),
          allowed: modelAllowed(allowed, id),
          isDefault: id === defaultModel,
          trainable: MODEL_CATALOG[id].trainable,
          canOverride,
          endpoint: row ? toEndpoint(row) : null,
        };
      });
      const own = rows
        .filter((r) => r.kind === "model")
        .map((r) => ({
          id: r.model,
          kind: "model" as const,
          label: r.label ?? r.model,
          baseModel: r.baseModel,
          checkpoint: r.checkpoint,
          serving: "endpoint" as const,
          allowed: modelAllowed(allowed, r.model),
          isDefault: r.model === defaultModel,
          endpoint: toEndpoint(r),
        }));
      return c.json([...catalog, ...own], 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/models/endpoints",
      tags: ["Models"],
      summary:
        "Serve a catalogue model from your own endpoint, or register an organization model by endpoint (Owner or Admin)",
      request: {
        params: OrgParam,
        body: {
          content: { "application/json": { schema: Register } },
          required: true,
        },
      },
      responses: { 201: json(Endpoint, "The registered endpoint") },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const body = c.req.valid("json");
      const catalog = (MODELS as readonly string[]).includes(body.model);
      if (catalog && runMode(c.env).kind === "cloud")
        throw new ApiError(
          409,
          "self_hosted_only",
          "Serving a built-in model from your own endpoint is only available on self-hosted installs. Register your model as org:<slug> instead.",
        );
      if (!catalog && !isOrgModel(body.model))
        invalid(
          'model is a catalogue model id or "org:<slug>" (lowercase letters, digits and hyphens)',
        );
      if (catalog && (body.label !== undefined || body.baseModel !== undefined))
        invalid("label and baseModel are only for organization models");
      if (!catalog && !body.label)
        invalid("an organization model needs a label");
      if (!catalog && !body.providerModel)
        invalid("an organization model needs a providerModel");
      const row = await withOrg(c.env, c.var.org, async (tx) => {
        const [taken] = await tx
          .select({ id: modelEndpoints.id })
          .from(modelEndpoints)
          .where(eq(modelEndpoints.model, body.model));
        if (taken)
          throw new ApiError(
            409,
            "endpoint_exists",
            `The model ${body.model} already has an endpoint. Change or delete that one.`,
          );
        const id = newId("modelEndpoint");
        const [created] = await tx
          .insert(modelEndpoints)
          .values({
            id,
            organizationId: c.var.org,
            model: body.model,
            kind: catalog ? "override" : "model",
            label: catalog ? null : body.label!,
            baseModel: catalog ? null : (body.baseModel ?? null),
            url: body.url,
            providerModel:
              body.providerModel ?? ROUTES[body.model as Model].model,
            checkpoint: body.checkpoint ?? null,
            createdBy: actor(c.var.caller).actorId,
            ...(body.key
              ? await sealKey(c.env, tx, c.var.org, id, body.key)
              : {}),
          })
          .returning();
        await audit(tx, {
          ...eventBase(c.var),
          action: "model_endpoint.created",
          targetType: "model_endpoint",
          targetId: id,
          data: described(created!),
        });
        return created!;
      });
      return c.json(toEndpoint(row), 201);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/models/endpoints/{id}",
      tags: ["Models"],
      summary: "Change a model endpoint (Owner or Admin)",
      request: {
        params: EndpointParam,
        body: {
          content: { "application/json": { schema: Change } },
          required: true,
        },
      },
      responses: { 200: json(Endpoint, "The changed endpoint") },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const row = await withOrg(c.env, c.var.org, async (tx) => {
        const existing = await findEndpoint(tx, id);
        if (
          existing.kind === "override" &&
          (body.label !== undefined || body.baseModel !== undefined)
        )
          invalid("label and baseModel are only for organization models");
        const key =
          body.key === undefined
            ? {}
            : body.key === null
              ? { keyVersion: null, keyCiphertext: null }
              : await sealKey(c.env, tx, c.var.org, id, body.key);
        const [changed] = await tx
          .update(modelEndpoints)
          .set({
            ...(body.url !== undefined && { url: body.url }),
            ...(body.providerModel !== undefined && {
              providerModel: body.providerModel,
            }),
            ...(body.label !== undefined && { label: body.label }),
            ...(body.baseModel !== undefined && { baseModel: body.baseModel }),
            ...(body.checkpoint !== undefined && {
              checkpoint: body.checkpoint,
            }),
            ...key,
            updatedAt: new Date(),
          })
          .where(eq(modelEndpoints.id, id))
          .returning();
        await audit(tx, {
          ...eventBase(c.var),
          action: "model_endpoint.updated",
          targetType: "model_endpoint",
          targetId: id,
          data: {
            ...described(changed!),
            changed: Object.keys(body).filter(
              (k) => body[k as keyof typeof body] !== undefined,
            ),
          },
        });
        return changed!;
      });
      return c.json(toEndpoint(row), 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/models/endpoints/{id}",
      tags: ["Models"],
      summary:
        "Delete a model endpoint; a catalogue model goes back to its provider (Owner or Admin)",
      request: { params: EndpointParam },
      responses: { 204: { description: "Deleted" } },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const { id } = c.req.valid("param");
      await withOrg(c.env, c.var.org, async (tx) => {
        const row = await findEndpoint(tx, id);
        await tx.delete(modelEndpoints).where(eq(modelEndpoints.id, id));
        await audit(tx, {
          ...eventBase(c.var),
          action: "model_endpoint.deleted",
          targetType: "model_endpoint",
          targetId: id,
          data: described(row),
        });
      });
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/models/endpoints/{id}/test",
      tags: ["Models"],
      summary:
        "Send the endpoint one tiny chat completion and report how it answered (Owner or Admin)",
      request: { params: EndpointParam },
      responses: {
        200: json(
          z
            .object({
              ok: z.boolean(),
              status: z.number().nullable().openapi({
                description: "The HTTP status; null when it did not answer",
              }),
              latencyMs: z.number(),
              reason: z
                .enum([
                  "unauthorized",
                  "timeout",
                  "unreachable",
                  "model_not_found",
                  "http",
                ])
                .nullable()
                .openapi({
                  description:
                    "Why it failed: the key was refused (401 or 403), no answer in time, no connection, the endpoint doesn't serve providerModel (404), or another HTTP error; null when ok",
                }),
              error: z.string().nullable(),
            })
            .openapi("ModelEndpointTest"),
          "How the endpoint answered",
        ),
      },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const { id } = c.req.valid("param");
      const target = await withOrg(c.env, c.var.org, async (tx) => {
        const row = await findEndpoint(tx, id);
        return { ...row, key: await openKey(c.env, tx, row) };
      });
      const started = Date.now();
      try {
        const response = await fetch(
          new URL("/v1/chat/completions", target.url),
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(target.key && { authorization: `Bearer ${target.key}` }),
            },
            body: JSON.stringify({
              model: target.providerModel,
              messages: [{ role: "user", content: "Reply with OK." }],
              max_tokens: 1,
            }),
            signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
          },
        );
        const text = await response.text();
        return c.json(
          {
            ok: response.ok,
            status: response.status,
            latencyMs: Date.now() - started,
            reason: response.ok
              ? null
              : response.status === 401 || response.status === 403
                ? ("unauthorized" as const)
                : response.status === 404
                  ? ("model_not_found" as const)
                  : ("http" as const),
            error: response.ok ? null : text.slice(0, 500),
          },
          200,
        );
      } catch (error) {
        const timeout = error instanceof Error && error.name === "TimeoutError";
        return c.json(
          {
            ok: false,
            status: null,
            latencyMs: Date.now() - started,
            reason: timeout ? ("timeout" as const) : ("unreachable" as const),
            error: timeout
              ? `No answer within ${TEST_TIMEOUT_MS / 1000} seconds.`
              : "The endpoint could not be reached.",
          },
          200,
        );
      }
    },
  );
