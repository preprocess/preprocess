// Settings → Models (PRE-145): the built-in catalogue and the organization's
// own models, each served by an endpoint it registered. "live" reads and
// writes /v1 through server functions; in development the other "models"
// scenarios serve seeded catalogues and answer writes as the API would.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";

import { staleAfterWrite } from "../../lib/data-changed";
import { currentScenario } from "../../scenarios/current-scenario";
import type { ScenarioState } from "../../scenarios/scenarios";
import { useOrganizationId } from "../auth/auth-context";
import { ApiError } from "../auth/client";
import { useAdministers } from "../settings/use-role";

export type ModelEndpoint = {
  id: string;
  host: string;
  hasKey: boolean;
  providerModel: string;
};

export type CatalogModel = {
  id: string;
  label: string;
  kind: "catalog";
  serving: "hosted" | "endpoint" | "install";
  allowed: boolean;
  trainable: boolean;
  isDefault: boolean;
  endpoint?: ModelEndpoint | null;
};

export type ModelUse =
  | {
      type: "deployment";
      agentId: string;
      agentName: string;
      deploymentId: string;
      production: boolean;
    }
  | { type: "settings"; agentId: string; agentName: string }
  | { type: "organization_default" }
  | { type: "eval_suite"; suiteId: string; suiteName: string };

export type OrgModel = {
  id: string;
  kind: "model";
  label: string;
  baseModel: string | null;
  checkpoint: string | null;
  serving: "endpoint";
  allowed: boolean;
  isDefault: boolean;
  endpoint: ModelEndpoint;
  usedBy: ModelUse[];
};

export type ModelEntry = CatalogModel | OrgModel;

export type EndpointInput = {
  label?: string;
  url?: string;
  providerModel?: string;
  key?: string;
  baseModel?: string | null;
  checkpoint?: string | null;
};

export type TestReason =
  "unauthorized" | "timeout" | "unreachable" | "model_not_found" | "http";

export type TestResult = {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  reason: TestReason | null;
};

type Failed = {
  ok: false;
  status: number;
  code?: string;
  message: string;
  usedBy?: ModelUse[];
};
type Result<T> = { ok: true; data: T } | Failed;

async function settle<T>(response: Response): Promise<Result<T>> {
  if (response.ok)
    return {
      ok: true,
      data: (response.status === 204 ? null : await response.json()) as T,
    };
  const body = await response
    .json<{
      error?: { code?: string; message?: string; refs?: ModelUse[] };
    }>()
    .catch(() => null);
  return {
    ok: false,
    status: response.status,
    code: body?.error?.code,
    message: body?.error?.message ?? `The request failed (${response.status}).`,
    usedBy: body?.error?.refs,
  };
}

const liveModels = createServerFn({ method: "GET" }).handler(
  async (): Promise<Result<ModelEntry[]>> => {
    const { activeOrgRequest } = await import("../../server/api.server");
    return settle(await activeOrgRequest("/models"));
  },
);

const liveWrite = createServerFn({ method: "POST" })
  .middleware([staleAfterWrite])
  .validator(
    (input: {
      method: "POST" | "PATCH" | "DELETE";
      path: string;
      body?: unknown;
    }) => input,
  )
  .handler(async ({ data }): Promise<Result<TestResult | null>> => {
    const { activeOrgRequest } = await import("../../server/api.server");
    const result = await settle<TestResult>(
      await activeOrgRequest(data.path, {
        method: data.method,
        ...(data.body === undefined ? {} : { body: JSON.stringify(data.body) }),
      }),
    );
    // Only a test's answer is read; a write's echo is refetched with the list.
    return result.ok && !data.path.endsWith("/test")
      ? { ok: true, data: null }
      : result;
  });

/** The refusal a Delete of a model still in use carries, with its uses. */
export class ModelInUseError extends ApiError {
  constructor(
    message: string,
    readonly usedBy: ModelUse[],
  ) {
    super(message, 409, "model_in_use");
  }
}

const unwrap = <T>(result: Result<T>): T => {
  if (result.ok) return result.data;
  if (result.code === "model_in_use")
    throw new ModelInUseError(result.message, result.usedBy ?? []);
  throw new ApiError(result.message, result.status, result.code);
};

// Seeded catalogues (PRE-145's frames). Writes stick in memory until the page
// reloads.

type SeedState = Exclude<ScenarioState<"models">, "live">;

const catalog = (selfHosted: boolean): CatalogModel[] => [
  {
    id: "deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    kind: "catalog",
    serving: "hosted",
    allowed: true,
    trainable: false,
    isDefault: true,
  },
  {
    id: "deepseek-v4.1-flash-fast",
    label: "DeepSeek V4.1 Flash (fast)",
    kind: "catalog",
    serving: "hosted",
    allowed: true,
    trainable: false,
    isDefault: false,
  },
  {
    id: "kimi-k3.1-pro",
    label: "Kimi K3.1 Pro",
    kind: "catalog",
    serving: selfHosted ? "endpoint" : "hosted",
    allowed: true,
    trainable: false,
    isDefault: false,
    endpoint: selfHosted
      ? {
          id: "mep_seed_kimi",
          host: "kimi.acme.internal",
          hasKey: true,
          providerModel: "kimi-k3.1-pro",
        }
      : null,
  },
  {
    id: "qwen3.8-27b",
    label: "Qwen 3.8 27B",
    kind: "catalog",
    serving: selfHosted ? "install" : "hosted",
    allowed: false,
    trainable: false,
    isDefault: false,
  },
];

const ORG_MODELS: OrgModel[] = [
  {
    id: "org:acme-renewals-v3",
    kind: "model",
    label: "Acme renewals v3",
    baseModel: "deepseek-v4.1-flash",
    checkpoint: "runs/renewals/step-400",
    serving: "endpoint",
    allowed: true,
    isDefault: false,
    endpoint: {
      id: "mep_seed_renewals",
      host: "models.acme.com",
      hasKey: true,
      providerModel: "renewals-v3",
    },
    usedBy: [
      {
        type: "deployment",
        agentId: "intake",
        agentName: "intake",
        deploymentId: "m2Xa9Qe",
        production: false,
      },
      { type: "eval_suite", suiteId: "renewals", suiteName: "Renewals" },
    ],
  },
  {
    id: "org:acme-intake-v1",
    kind: "model",
    label: "Acme intake v1",
    baseModel: null,
    checkpoint: null,
    serving: "endpoint",
    allowed: false,
    isDefault: false,
    endpoint: {
      id: "mep_seed_intake",
      host: "gpu-02.acme.internal",
      hasKey: true,
      providerModel: "intake-v1",
    },
    usedBy: [],
  },
];

const seededWrites = new Map<SeedState, ModelEntry[]>();

/** A seeded state's models; undefined never settles, for the loading state. */
function seeded(state: SeedState): ModelEntry[] | undefined {
  const written = seededWrites.get(state);
  if (written) return written;
  switch (state) {
    case "owner":
    case "member":
      return [...catalog(false), ...ORG_MODELS];
    case "self-hosted":
      return [...catalog(true), ...ORG_MODELS];
    case "empty":
    case "member-empty":
      return catalog(false);
    case "error":
      throw new ApiError("Something went wrong. Try again.", 500);
    case "no-access":
      throw new ApiError("Forbidden.", 403);
    case "loading":
      return undefined;
  }
}

/** The org:<slug> part a model's name derives. */
export const slugOf = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);

const hostOf = (url: string) => new URL(url).host;

// Answers a seeded write as the API would.
function seededWrite(
  state: SeedState,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: (EndpointInput & { model?: string }) | undefined,
): unknown {
  const models = seeded(state) ?? [];
  const endpointId = path.split("/")[3];
  const owner = models.find((m) => m.endpoint?.id === endpointId);
  if (path.endsWith("/test")) {
    if (!owner) throw new ApiError("No such model endpoint.", 404);
    return owner.endpoint?.host.endsWith(".internal")
      ? { ok: false, status: 401, latencyMs: 96, reason: "unauthorized" }
      : { ok: true, status: 200, latencyMs: 412, reason: null };
  }
  if (method === "DELETE") {
    if (!owner) throw new ApiError("No such model endpoint.", 404);
    if (owner.kind === "model" && owner.usedBy.length > 0)
      throw new ModelInUseError("This model is still in use.", owner.usedBy);
    seededWrites.set(
      state,
      owner.kind === "model"
        ? models.filter((m) => m !== owner)
        : models.map((m) =>
            m === owner ? { ...m, serving: "hosted", endpoint: null } : m,
          ),
    );
    return null;
  }
  const input = body ?? {};
  if (method === "POST") {
    const model = input.model ?? "";
    if (models.some((m) => m.id === model))
      throw new ApiError(
        `The model ${model} already has an endpoint.`,
        409,
        "endpoint_exists",
      );
    const endpoint: ModelEndpoint = {
      id: `mep_seed_${crypto.randomUUID().slice(0, 8)}`,
      host: hostOf(input.url!),
      hasKey: Boolean(input.key),
      providerModel: input.providerModel ?? model,
    };
    seededWrites.set(
      state,
      model.startsWith("org:")
        ? [
            ...models,
            {
              id: model,
              kind: "model",
              label: input.label ?? model,
              baseModel: input.baseModel ?? null,
              checkpoint: input.checkpoint ?? null,
              serving: "endpoint",
              allowed: true,
              isDefault: false,
              endpoint,
              usedBy: [],
            },
          ]
        : models.map((m) =>
            m.id === model && m.kind === "catalog"
              ? { ...m, serving: "endpoint", endpoint }
              : m,
          ),
    );
    return endpoint;
  }
  if (!owner?.endpoint) throw new ApiError("No such model endpoint.", 404);
  const endpoint: ModelEndpoint = {
    ...owner.endpoint,
    ...(input.url ? { host: hostOf(input.url) } : {}),
    ...(input.providerModel ? { providerModel: input.providerModel } : {}),
    ...(input.key ? { hasKey: true } : {}),
  };
  seededWrites.set(
    state,
    models.map((m) =>
      m !== owner
        ? m
        : m.kind === "model"
          ? {
              ...m,
              endpoint,
              label: input.label ?? m.label,
              baseModel:
                input.baseModel === undefined ? m.baseModel : input.baseModel,
              checkpoint:
                input.checkpoint === undefined
                  ? m.checkpoint
                  : input.checkpoint,
            }
          : { ...m, endpoint },
    ),
  );
  return endpoint;
}

const never = <T>() => new Promise<T>(() => {});

export function useModels() {
  const organizationId = useOrganizationId();
  const state = currentScenario().models;
  return useQuery({
    queryKey: ["models", organizationId, state],
    retry: false,
    queryFn: async () => {
      if (state === "live") return unwrap(await liveModels());
      const seed = seeded(state);
      return seed ?? never<ModelEntry[]>();
    },
  });
}

/** Whether the signed-in person registers, tests and deletes endpoints. */
export function useManagesModels() {
  const state = currentScenario().models;
  const administers = useAdministers();
  if (state === "live") return administers;
  return state !== "member" && state !== "member-empty";
}

/**
 * Whether built-in models can be served from the organization's own endpoint:
 * only on a self-hosted install, which GET /models shows by serving a built-in
 * from an endpoint or the install's own configuration.
 */
export const servesOwnBuiltIns = (models: readonly ModelEntry[]) =>
  models.some(
    (m) =>
      m.kind === "catalog" &&
      (m.serving === "endpoint" || m.serving === "install"),
  );

export function useModelActions() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const call = async <T>(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: EndpointInput & { model?: string },
  ): Promise<T> => {
    const state = currentScenario().models;
    if (state === "live")
      return unwrap(await liveWrite({ data: { method, path, body } })) as T;
    await new Promise((resolve) => setTimeout(resolve, 600));
    return seededWrite(state, method, path, body) as T;
  };
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["models", organizationId] });
  const endpoint = (id: string, rest = "") =>
    `/models/endpoints/${encodeURIComponent(id)}${rest}`;
  return {
    register: async (input: EndpointInput & { model: string }) => {
      await call("POST", "/models/endpoints", input);
      await refresh();
    },
    update: async (id: string, input: EndpointInput) => {
      await call("PATCH", endpoint(id), input);
      await refresh();
    },
    remove: async (id: string) => {
      try {
        await call("DELETE", endpoint(id));
      } finally {
        await refresh();
      }
    },
    test: (id: string) => call<TestResult>("POST", endpoint(id, "/test")),
  };
}
