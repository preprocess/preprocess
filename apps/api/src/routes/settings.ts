// Organization defaults and an agent's settings with their sources (spec 5,
// mvp-surface "Effective settings for an agent"). An Owner or Admin sets the
// defaults; Owners, Admins and the Developers group set an agent's dashboard
// overrides, which last until a deployment is promoted.

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { audit } from "@preprocess/db/audit";
import { withOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { agents } from "@preprocess/db/schema/access";
import { deployments } from "@preprocess/db/schema/deployments";
import {
  agentOverrides,
  organizationDefaults,
} from "@preprocess/db/schema/settings";
import type { SettingValues } from "@preprocess/db/schema/settings";
import { and, desc, eq, isNotNull } from "drizzle-orm";

import { assertModelAllowed } from "../allowed-models.ts";
import { actor, eventBase, requireAdmin, requireDeveloper } from "../caller.ts";
import type { OrgVariables } from "../caller.ts";
import { ApiError } from "../cases.ts";
import type { Manifest } from "../deploy.ts";
import type { Env } from "../env.ts";
import { modelSlug, trackEvent } from "../analytics.ts";
import {
  agentOverrideValues,
  DEFAULTS,
  organizationDefaultValues,
  overrideWarnings,
  resolveSettings,
  settingSchema,
} from "../settings.ts";

const OrgParam = z.object({ org: z.string() });
const AgentParam = OrgParam.extend({ agent: z.string() });
const KeyParam = AgentParam.extend({ key: z.string() });

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

const Defaults = z
  .object({
    model: DEFAULTS.model.schema.nullable().optional(),
    reasoning: DEFAULTS.reasoning.schema.nullable().optional(),
    ocr: DEFAULTS.ocr.schema.nullable().optional(),
    searchCases: DEFAULTS.searchCases.schema.nullable().optional(),
    timeoutSeconds: DEFAULTS.timeoutSeconds.schema.nullable().optional(),
    toolRetries: DEFAULTS.toolRetries.schema.nullable().optional(),
    sandboxImage: DEFAULTS.sandboxImage.schema.nullable().optional(),
    "evals.onPush": DEFAULTS["evals.onPush"].schema
      .nullable()
      .optional()
      .openapi({
        description:
          "Run the agent's suites marked runOnPush against each new production deployment when it becomes ready",
      }),
  })
  .strict()
  .openapi("OrganizationDefaults", {
    description:
      "Organization defaults by setting key; an absent or null key has none",
  });

const Setting = z
  .object({
    key: z.string(),
    value: Scalar.nullable(),
    source: z.enum(["override", "code", "organization", "default"]),
    code: Scalar.nullable(),
    organization: Scalar.nullable(),
    override: Scalar.nullable(),
  })
  .openapi("Setting");

const AgentSettings = z
  .object({
    deployment: z.string().nullable().openapi({
      description:
        "The deployment whose code the settings read: production, else the newest",
    }),
    settings: z.array(Setting),
    warnings: z.array(z.string()),
  })
  .openapi("AgentSettings");

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const findAgent = async (tx: Tx, slug: string) => {
  const [agent] = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.slug, slug));
  if (!agent) throw new ApiError(404, "not_found", "No such agent.");
  return agent;
};

const currentDeployment = async (tx: Tx, agentId: string) => {
  const select = () =>
    tx
      .select({ id: deployments.id, manifest: deployments.manifest })
      .from(deployments);
  const [production] = await select()
    .where(
      and(eq(deployments.agentId, agentId), isNotNull(deployments.promotedAt)),
    )
    .orderBy(desc(deployments.promotedAt))
    .limit(1);
  if (production) return production;
  const [newest] = await select()
    .where(eq(deployments.agentId, agentId))
    .orderBy(desc(deployments.createdAt))
    .limit(1);
  return newest;
};

const agentSettings = async (tx: Tx, agentId: string) => {
  const deployment = await currentDeployment(tx, agentId);
  const manifest = (deployment?.manifest as Manifest | undefined) ?? null;
  return {
    deployment: deployment?.id ?? null,
    settings: (await resolveSettings(tx, agentId, manifest)).map((s) => ({
      ...s,
      value: s.value as string | number | boolean | null,
      code: s.code as string | number | boolean | null,
      organization: s.organization as string | number | boolean | null,
      override: s.override as string | number | boolean | null,
    })),
    warnings: manifest
      ? overrideWarnings(await agentOverrideValues(tx, agentId), manifest)
      : [],
  };
};

const setOverride = async (
  tx: Tx,
  vars: OrgVariables,
  slug: string,
  key: string,
  value: string | number | boolean | undefined,
) => {
  await requireDeveloper(tx, vars.caller);
  const agent = await findAgent(tx, slug);
  if (key === "model" && value !== undefined)
    await assertModelAllowed(tx, value as string);
  const before = await agentOverrideValues(tx, agent.id);
  const { [key]: previous, ...rest } = before;
  const next: SettingValues =
    value === undefined ? rest : { ...rest, [key]: value };
  const updatedBy = actor(vars.caller).actorId;
  await tx
    .insert(agentOverrides)
    .values({
      organizationId: vars.org,
      agentId: agent.id,
      values: next,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: [agentOverrides.organizationId, agentOverrides.agentId],
      set: { values: next, updatedBy, updatedAt: new Date() },
    });
  await audit(tx, {
    ...eventBase(vars),
    action:
      value === undefined
        ? "settings.override.cleared"
        : "settings.override.set",
    targetType: "agent",
    targetId: agent.id,
    data: { key, before: previous ?? null, after: value ?? null },
  });
  return { agentId: agent.id, body: await agentSettings(tx, agent.id) };
};

const SETTINGS = {
  model: "model",
  reasoning: "reasoning",
  ocr: "ocr",
  searchCases: "search_cases",
  timeoutSeconds: "timeout_seconds",
  toolRetries: "tool_retries",
  sandboxImage: "sandbox_image",
  "evals.onPush": "evals_on_push",
} as const;

// After an override commits: which setting changed, and the model when it
// is the one chosen.
const trackOverride = async (
  env: Env,
  vars: OrgVariables,
  agentId: string,
  key: string,
  value: unknown,
) => {
  const person = vars.caller.type === "person" ? vars.caller.userId : null;
  await trackEvent(env, "agent_setting_changed", vars.org, person, {
    agent_id: agentId,
    setting:
      key in SETTINGS
        ? SETTINGS[key as keyof typeof SETTINGS]
        : "schedule_previews",
    cleared: value === undefined,
  });
  if (key === "model" && typeof value === "string")
    await trackEvent(env, "model_selected", vars.org, person, {
      model: modelSlug(value),
      scope: "agent",
      agent_id: agentId,
    });
};

export const settingsRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: OrgVariables;
}>()
  .openapi(
    createRoute({
      method: "get",
      path: "/defaults",
      tags: ["Settings"],
      summary: "The organization's defaults for agent settings",
      request: { params: OrgParam },
      responses: { 200: json(Defaults, "Defaults") },
    }),
    async (c) =>
      c.json(await withOrg(c.env, c.var.org, organizationDefaultValues), 200),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/defaults",
      tags: ["Settings"],
      summary:
        "Set or clear organization defaults (Owner or Admin); null clears a key",
      request: {
        params: OrgParam,
        body: { content: { "application/json": { schema: Defaults } } },
      },
      responses: { 200: json(Defaults, "The new defaults") },
    }),
    async (c) => {
      requireAdmin(c.var.caller);
      const patch = c.req.valid("json") as Record<
        string,
        string | number | boolean | null | undefined
      >;
      const body = await withOrg(c.env, c.var.org, async (tx) => {
        if (typeof patch.model === "string")
          await assertModelAllowed(tx, patch.model);
        const before = await organizationDefaultValues(tx);
        const next: SettingValues = { ...before };
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) continue;
          if (value === null) delete next[key];
          else next[key] = value;
        }
        const updatedBy = actor(c.var.caller).actorId;
        await tx
          .insert(organizationDefaults)
          .values({ organizationId: c.var.org, values: next, updatedBy })
          .onConflictDoUpdate({
            target: organizationDefaults.organizationId,
            set: { values: next, updatedBy, updatedAt: new Date() },
          });
        await audit(tx, {
          ...eventBase(c.var),
          action: "settings.defaults.updated",
          targetType: "organization",
          targetId: c.var.org,
          data: { before, after: next },
        });
        return next;
      });
      if (typeof patch.model === "string")
        await trackEvent(
          c.env,
          "model_selected",
          c.var.org,
          c.var.caller.type === "person" ? c.var.caller.userId : null,
          {
            model: modelSlug(patch.model),
            scope: "organization",
            agent_id: null,
          },
        );
      return c.json(body, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/agents/{agent}/settings",
      tags: ["Settings"],
      summary: "An agent's effective settings, each with its source",
      request: { params: AgentParam },
      responses: { 200: json(AgentSettings, "Settings") },
    }),
    async (c) =>
      c.json(
        await withOrg(c.env, c.var.org, async (tx) =>
          agentSettings(
            tx,
            (await findAgent(tx, c.req.valid("param").agent)).id,
          ),
        ),
        200,
      ),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/agents/{agent}/settings/{key}",
      tags: ["Settings"],
      summary:
        "Override a setting from the dashboard until the next promotion (Owners, Admins, Developers)",
      request: {
        params: KeyParam,
        body: {
          content: {
            "application/json": { schema: z.object({ value: Scalar }) },
          },
        },
      },
      responses: { 200: json(AgentSettings, "Settings") },
    }),
    async (c) => {
      const { agent, key } = c.req.valid("param");
      const parsed = settingSchema(key)?.safeParse(c.req.valid("json").value);
      if (!parsed) throw new ApiError(404, "not_found", `No setting ${key}.`);
      if (!parsed.success)
        throw new ApiError(
          400,
          "invalid_value",
          `Not a value for ${key}: ${z.prettifyError(parsed.error)}`,
        );
      const value = parsed.data as string | number | boolean;
      const { agentId, body } = await withOrg(c.env, c.var.org, (tx) =>
        setOverride(tx, c.var, agent, key, value),
      );
      await trackOverride(c.env, c.var, agentId, key, value);
      return c.json(body, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/agents/{agent}/settings/{key}",
      tags: ["Settings"],
      summary: "Clear a dashboard override (Owners, Admins, Developers)",
      request: { params: KeyParam },
      responses: { 200: json(AgentSettings, "Settings") },
    }),
    async (c) => {
      const { agent, key } = c.req.valid("param");
      if (!settingSchema(key))
        throw new ApiError(404, "not_found", `No setting ${key}.`);
      const { agentId, body } = await withOrg(c.env, c.var.org, (tx) =>
        setOverride(tx, c.var, agent, key, undefined),
      );
      await trackOverride(c.env, c.var, agentId, key, undefined);
      return c.json(body, 200);
    },
  );
