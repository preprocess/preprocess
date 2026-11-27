// Retention settings (spec 16a): how long the organization keeps documents,
// run capture, run logs and whole cases after a case closes. "live" reads and
// writes /v1 through server functions; in development the other "retention"
// scenarios serve seeded periods and answer saves as the API would.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";

import { staleAfterWrite } from "../../lib/data-changed";
import { currentScenario } from "../../scenarios/current-scenario";
import type { ScenarioState } from "../../scenarios/scenarios";
import { useOrganizationId } from "../auth/auth-context";
import { ApiError } from "../auth/client";

export type RetentionKey =
  "documentsDays" | "runCaptureDays" | "runLogsDays" | "casesDays";
export type Periods = Record<RetentionKey, number | null>;
export type Retention = Periods & { updatedAt: string | null };
export type RetentionRole = "owner" | "admin";

export const MIN_DAYS = 7;
export const MAX_DAYS = 36_500;

// Keeping forever is the longest period, as the API counts it.
export const shortens = (before: number | null, after: number | null) =>
  after !== null && (before === null || after < before);

const SHORTEN_REFUSED =
  "Only Owners can shorten how long data is kept. Admins can lengthen it.";

type Saved =
  | { ok: true; retention: Retention }
  | { ok: false; status: number; message: string };

/** The signed-in person's role where they may manage retention, else null. */
export const loadRetentionRole = createServerFn({ method: "GET" }).handler(
  async (): Promise<RetentionRole | null> => {
    const state = currentScenario().retention;
    if (state !== "live") return state === "admin" ? "admin" : "owner";
    const { activeOrganizationId, apiRequest } =
      await import("../../server/api.server");
    const member = await apiRequest(
      `/api/auth/organization/get-active-member-role?organizationId=${encodeURIComponent(await activeOrganizationId())}`,
    );
    if (!member.ok) {
      await member.body?.cancel();
      return null;
    }
    const roles = (await member.json<{ role: string }>()).role.split(",");
    return roles.includes("owner")
      ? "owner"
      : roles.includes("admin")
        ? "admin"
        : null;
  },
);

const liveRetention = createServerFn({ method: "GET" }).handler(
  async (): Promise<Retention> => {
    const { activeOrgJson } = await import("../../server/api.server");
    return activeOrgJson<Retention>("/retention");
  },
);

const liveSaveRetention = createServerFn({ method: "POST" })
  .middleware([staleAfterWrite])
  .validator((change: Partial<Periods>) => change)
  .handler(async ({ data: change }): Promise<Saved> => {
    const { activeOrgRequest } = await import("../../server/api.server");
    const response = await activeOrgRequest("/retention", {
      method: "PUT",
      body: JSON.stringify(change),
    });
    if (response.ok)
      return { ok: true, retention: await response.json<Retention>() };
    const body = await response
      .json<{ error?: { message?: string } }>()
      .catch(() => null);
    return {
      ok: false,
      status: response.status,
      message:
        body?.error?.message ?? `The request failed (${response.status}).`,
    };
  });

const FOREVER: Retention = {
  documentsDays: null,
  runCaptureDays: null,
  runLogsDays: null,
  casesDays: null,
  updatedAt: null,
};

const MIXED: Retention = {
  documentsDays: 180,
  runCaptureDays: 90,
  runLogsDays: 30,
  casesDays: null,
  updatedAt: "2026-11-20T17:42:00.000Z",
};

// Seeded saves stick in memory until the page reloads.
const seededWrites = new Map<string, Retention>();

/** A seeded state's periods; undefined never settles, for the loading state. */
function seeded(
  state: Exclude<ScenarioState<"retention">, "live">,
): Retention | undefined {
  switch (state) {
    case "forever":
      return seededWrites.get(state) ?? FOREVER;
    case "custom":
    case "admin":
      return seededWrites.get(state) ?? MIXED;
    case "error":
      throw new ApiError("Something went wrong. Try again.", 500);
    case "loading":
      return undefined;
  }
}

const never = <T>() => new Promise<T>(() => {});

export function useRetention() {
  const organizationId = useOrganizationId();
  const state = currentScenario().retention;
  return useQuery({
    queryKey: ["retention", organizationId, state],
    retry: false,
    queryFn: () => {
      if (state === "live") return liveRetention();
      const seed = seeded(state);
      return seed ? Promise.resolve(seed) : never<Retention>();
    },
  });
}

/** Saves the changed periods; a refusal throws with the API's message. */
export function useSaveRetention() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  return async (change: Partial<Periods>) => {
    const state = currentScenario().retention;
    if (state === "live") {
      const saved = await liveSaveRetention({ data: change });
      if (!saved.ok) throw new ApiError(saved.message, saved.status);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const before = seeded(state) ?? FOREVER;
      const keys = Object.keys(change) as RetentionKey[];
      if (
        state === "admin" &&
        keys.some((key) => shortens(before[key], change[key] ?? null))
      )
        throw new ApiError(SHORTEN_REFUSED, 403);
      seededWrites.set(state, {
        ...before,
        ...change,
        updatedAt: new Date().toISOString(),
      });
    }
    await queryClient.invalidateQueries({
      queryKey: ["retention", organizationId],
    });
  };
}
