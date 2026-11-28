// Directory sync settings (PRE-138): the organization's SCIM connection, its
// token and what its identity provider synced. "live" reads and writes /v1
// through server functions; in development the other "directory-sync"
// scenarios serve seeded settings and answer writes as the API would.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";

import { staleAfterWrite } from "../../lib/data-changed";
import { currentScenario } from "../../scenarios/current-scenario";
import { useOrganizationId } from "../auth/auth-context";
import { ApiError } from "../auth/client";
import {
  SEEDED_SECRET,
  seededDirectorySync,
  type DirectorySync,
  type DirectorySyncSeedState,
  type DirectorySyncView,
  type RemovedGroup,
  type ScimCurrentToken,
} from "./directory-sync-seed";
import { useOwns } from "./use-role";

type Method = "POST" | "DELETE";
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

async function settle<T>(response: Response): Promise<Result<T>> {
  if (response.ok)
    return {
      ok: true,
      data: (response.status === 204 ? null : await response.json()) as T,
    };
  const body = await response
    .json<{ error?: string | { message?: string } }>()
    .catch(() => null);
  const message =
    typeof body?.error === "string" ? body.error : body?.error?.message;
  if (!message)
    console.error(`Directory sync request failed: ${response.status}`);
  return {
    ok: false,
    status: response.status,
    message: message ?? "Something went wrong. Try again.",
  };
}

const unwrap = <T>(result: Result<T>): T => {
  if (result.ok) return result.data;
  throw new ApiError(result.message, result.status);
};

const liveStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<Result<DirectorySync>> => {
    const { activeOrgRequest } = await import("../../server/api.server");
    return settle(await activeOrgRequest("/scim"));
  },
);

/** An issued token as POST /scim/tokens answers it: shown once. */
type Issued = { prefix: string; token: string };

const liveWrite = createServerFn({ method: "POST" })
  .middleware([staleAfterWrite])
  .validator((input: { method: Method; path: string; body?: unknown }) => input)
  .handler(async ({ data }): Promise<Result<Issued | null>> => {
    const { activeOrgRequest } = await import("../../server/api.server");
    return settle(
      await activeOrgRequest(data.path, {
        method: data.method,
        ...(data.body === undefined
          ? {}
          : { body: JSON.stringify(data.body) }),
      }),
    );
  });

// Seeded writes stick in memory until the page reloads.
const seededWrites = new Map<DirectorySyncSeedState, DirectorySyncView>();
const never = <T>() => new Promise<T>(() => {});

function seeded(state: DirectorySyncSeedState): DirectorySyncView | undefined {
  switch (state) {
    case "member":
      throw new ApiError("Only Owners can manage directory sync.", 403);
    case "error":
      throw new ApiError("Something went wrong. Try again.", 500);
    case "loading":
      return undefined;
    default:
      return seededWrites.get(state) ?? seededDirectorySync(state);
  }
}

/** What GET /scim/removed-groups answers in a seeded state, for the notice. */
export function seededRemovedGroups(
  state: DirectorySyncSeedState,
): RemovedGroup[] {
  if (state === "member" || state === "loading" || state === "error")
    return [];
  const { settings } = seededWrites.get(state) ?? seededDirectorySync(state);
  return settings.groups.flatMap((group) =>
    group.removedAt
      ? [
          {
            id: group.id,
            slug: group.slug,
            name: group.name,
            removedAt: group.removedAt,
            agents: group.agents ?? 0,
          },
        ]
      : [],
  );
}

function seededWrite(
  state: DirectorySyncSeedState,
  method: Method,
  path: string,
): unknown {
  const before = seeded(state);
  if (!before) return never();
  const { settings } = before;
  if (!settings.canEdit)
    throw new ApiError("Only Owners can manage directory sync.", 403);
  const save = (next: DirectorySync) =>
    seededWrites.set(state, { ...before, settings: next });
  if (method === "POST" && path.startsWith("/scim/tokens")) {
    const secret =
      state === "token-created"
        ? SEEDED_SECRET
        : `scim_${crypto.randomUUID().replaceAll("-", "")}`;
    const token: ScimCurrentToken = {
      prefix: `ba_scim_credential_${crypto.randomUUID().slice(0, 8)}`,
      status: "active",
      last4: secret.slice(-4),
      createdAt: new Date().toISOString(),
      createdBy: { id: "user_dana", name: "Dana Whitfield" },
      lastUsedAt: null,
      expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    };
    save({ ...settings, token });
    return { prefix: token.prefix, token: secret } satisfies Issued;
  }
  if (method === "DELETE" && path.startsWith("/scim/tokens/")) {
    save({ ...settings, token: null });
    return null;
  }
  const deleted = /^\/groups\/([^/]+)$/.exec(path);
  if (method === "DELETE" && deleted) {
    const group = settings.groups.find((g) => g.id === deleted[1]);
    if (group?.agents)
      throw new ApiError(
        `The group cannot be deleted: live deployments of claims-intake, payouts name the group ${group.slug}. Deploy code that stops naming it first.`,
        409,
      );
    save({
      ...settings,
      groups: settings.groups.filter((g) => g.id !== deleted[1]),
    });
    return null;
  }
  throw new ApiError("Not found.", 404);
}

/** The page's settings and the reader's role; a Member's read fails with 403. */
export function useDirectorySync() {
  const organizationId = useOrganizationId();
  const state = currentScenario()["directory-sync"];
  const owns = useOwns();
  return useQuery({
    queryKey: ["directory-sync", organizationId, state, owns],
    retry: false,
    queryFn: async (): Promise<DirectorySyncView> => {
      if (state === "live")
        return {
          settings: unwrap(await liveStatus()),
          role: owns ? "owner" : "admin",
        };
      return seeded(state) ?? never<DirectorySyncView>();
    },
  });
}

/** The dialog a seeded state opens with, as Design's frames show it. */
export function seededDialog(): "token" | "regenerate" | "revoke" | null {
  const state = currentScenario()["directory-sync"];
  if (state === "token-created") return "token";
  if (state === "regenerate" || state === "revoke") return state;
  return null;
}

export function useDirectorySyncActions() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const call = async <T>(method: Method, path: string, body?: unknown) => {
    const state = currentScenario()["directory-sync"];
    try {
      if (state === "live")
        return unwrap(await liveWrite({ data: { method, path, body } })) as T;
      await new Promise((resolve) => setTimeout(resolve, 600));
      return seededWrite(state, method, path) as T;
    } finally {
      await queryClient.invalidateQueries({
        queryKey: ["directory-sync", organizationId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["removed-groups", organizationId],
      });
    }
  };
  return {
    generate: () => call<Issued>("POST", "/scim/tokens", {}),
    regenerate: () => call<Issued>("POST", "/scim/tokens/regenerate", {}),
    revoke: (prefix: string) =>
      call<null>("DELETE", `/scim/tokens/${encodeURIComponent(prefix)}`),
    deleteGroup: (id: string) =>
      call<null>("DELETE", `/groups/${encodeURIComponent(id)}`),
  };
}
