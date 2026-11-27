// Billing reads and actions for the settings page and the sidebar. "live"
// reads the API; in development the other billing scenarios serve seeded
// states and answer actions as the "billing-result" scenario says.

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { currentScenario } from "../../scenarios/current-scenario";
import { useOrganizationId } from "../auth/auth-context";
import { ApiError, apiFetch, orgApi } from "../auth/client";
import {
  seededBilling,
  seededPreview,
  seededSpending,
  seededUsage,
  writeSeededBilling,
  type SeededBilling,
} from "./billing-seed";
import type {
  AutoReload,
  Billing,
  BillingUsage,
  ChangePreview,
  Purchase,
  Spending,
} from "./billing-types";

const scenario = () => currentScenario().billing;
const seeded = (): SeededBilling | null => {
  const state = scenario();
  return state === "live" ? null : state;
};

const never = <T>() => new Promise<T>(() => {});

// Seeded data, or a read that never settles for the loading state.
const fromSeed = <T>(value: T | undefined) =>
  value === undefined ? never<T>() : Promise.resolve(value);

/** Whether the signed-in person is the organization's Owner. */
export function useIsOwner() {
  const organizationId = useOrganizationId();
  const member = useQuery({
    queryKey: ["active-member", organizationId],
    queryFn: () =>
      apiFetch<{ role: string }>(
        `/api/auth/organization/get-active-member-role?organizationId=${encodeURIComponent(organizationId)}`,
      ),
  });
  if (seeded()) return true;
  if (!member.data) return undefined;
  return member.data.role.split(",").includes("owner");
}

/** The organization's billing, or null where billing is off (404). */
export function useBilling() {
  const organizationId = useOrganizationId();
  const state = scenario();
  return useQuery({
    queryKey: ["billing", organizationId, state],
    queryFn: async (): Promise<Billing | null> => {
      const seed = seeded();
      if (seed) return fromSeed(seededBilling(seed));
      try {
        return await orgApi<Billing>(organizationId, "/billing");
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) return null;
        throw cause;
      }
    },
  });
}

export function useBillingUsage(enabled: boolean) {
  const organizationId = useOrganizationId();
  const state = scenario();
  return useQuery({
    queryKey: ["billing-usage", organizationId, state],
    enabled,
    queryFn: () => {
      const seed = seeded();
      return seed
        ? fromSeed(seededUsage(seed))
        : orgApi<BillingUsage>(organizationId, "/billing/usage");
    },
  });
}

export function useSpending(enabled: boolean) {
  const organizationId = useOrganizationId();
  const state = scenario();
  return useQuery({
    queryKey: ["spending", organizationId, state],
    enabled,
    queryFn: () => {
      const seed = seeded();
      return seed
        ? fromSeed(seededSpending(seed))
        : orgApi<Spending>(organizationId, "/spending");
    },
  });
}

export function useChangePreview(enabled: boolean) {
  const organizationId = useOrganizationId();
  const state = scenario();
  return useQuery({
    queryKey: ["billing-change-preview", organizationId, state],
    enabled,
    queryFn: () => {
      const seed = seeded();
      return seed
        ? Promise.resolve(seededPreview(seed))
        : orgApi<ChangePreview>(organizationId, "/billing/plan/change/preview");
    },
  });
}

// A seeded action's answer, after a moment so progress shows.
async function seededResult<T>(ok: () => T): Promise<T | Purchase> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  const result = currentScenario()["billing-result"];
  if (result === "error")
    throw new ApiError("Something went wrong. Try again.", 500);
  if (result === "confirm-payment")
    return { url: "#confirm-payment", action: "confirm_payment" };
  if (result === "declined")
    return { url: "#another-card", action: "card_declined" };
  return ok();
}

const returnTo = () => window.location.href;

export function useBillingActions() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["billing", organizationId] }),
      queryClient.invalidateQueries({
        queryKey: ["billing-usage", organizationId],
      }),
    ]);
  const post = <T>(path: string, body?: unknown, method = "POST") =>
    orgApi<T>(organizationId, path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const write = (change: (billing: Billing) => Billing) => {
    const seed = seeded();
    if (seed) writeSeededBilling(seed, change);
  };

  return {
    refresh,

    /** Buys credits on the card on file, or on another card at checkout. */
    async buyCredits(credits: number, newCard: boolean): Promise<Purchase> {
      const purchase = seeded()
        ? await seededResult<Purchase>(() => {
            if (newCard) return { url: "#checkout", action: null };
            write((b) => ({
              ...b,
              credits: b.credits && {
                remaining: b.credits.remaining + credits - b.credits.owed,
                owed: 0,
              },
            }));
            return { url: null, action: null };
          })
        : await post<Purchase>("/billing/credits", {
            credits,
            newCard,
            returnTo: returnTo(),
          });
      await refresh();
      return purchase;
    },

    /** Moves Free to Team with its first credits in one charge. */
    async upgrade(credits: number): Promise<Purchase> {
      const purchase = seeded()
        ? await seededResult<Purchase>(() => {
            write((b) => ({
              ...b,
              plan: "team",
              seats: null,
              credits: b.credits && {
                remaining: b.credits.remaining + credits,
                owed: 0,
              },
            }));
            return { url: null, action: null };
          })
        : await post<{ url: string; paid: boolean } & Purchase>(
            "/billing/checkout",
            { plan: "team", credits, returnTo: returnTo() },
          ).then((r) => ({ url: r.paid ? null : r.url, action: r.action }));
      await refresh();
      return purchase;
    },

    /** Cancels Team at the end of its billing period. */
    async switchToFree(keep: string[] | undefined, reason: string | undefined) {
      if (seeded()) {
        await seededResult(() => null);
        write((b) => ({
          ...b,
          change: { plan: "free", at: "2026-12-01T00:00:00.000Z" },
        }));
      } else await post("/billing/plan", { plan: "free", keep, reason });
      await refresh();
    },

    /** Undoes a scheduled cancellation. */
    async keepTeam() {
      if (seeded()) {
        await seededResult(() => null);
        write((b) => ({ ...b, change: null }));
      } else await post("/billing/plan/change", undefined, "DELETE");
      await refresh();
    },

    async restoreRoles() {
      const seed = seeded();
      if (!seed)
        return (await post<{ people: number }>("/billing/roles/restore"))
          .people;
      await seededResult(() => null);
      const people = seededBilling(seed)?.switched?.people ?? 0;
      write((b) => ({ ...b, switched: null }));
      return people;
    },

    async saveAutoReload({
      enabled,
      belowCredits,
      addCredits,
      monthlyLimitUsd,
    }: AutoReload) {
      const next = { enabled, belowCredits, addCredits, monthlyLimitUsd };
      if (seeded())
        write((b) => ({
          ...b,
          autoReload: {
            failed: null,
            capReachedUntil: null,
            ...b.autoReload,
            ...next,
          },
        }));
      else await post("/billing/auto-reload", next, "PUT");
      await refresh();
    },

    /** Runs a failed auto-reload again on the card on file. */
    async retryAutoReload(): Promise<Purchase> {
      const purchase = seeded()
        ? await seededResult<Purchase>(() => {
            write((b) => ({
              ...b,
              credits: b.credits &&
                b.autoReload && {
                  remaining:
                    b.credits.remaining +
                    b.autoReload.addCredits -
                    b.credits.owed,
                  owed: 0,
                },
              autoReload: b.autoReload && { ...b.autoReload, failed: null },
            }));
            return { url: null, action: null };
          })
        : await post<Purchase>("/billing/auto-reload/retry", {
            returnTo: returnTo(),
          });
      await refresh();
      return purchase;
    },

    /** Sends the Owner to the payment portal (card, billing email, invoices). */
    async openPortal() {
      if (seeded()) return;
      const { url } = await post<{ url: string }>("/billing/portal", {
        returnTo: returnTo(),
      });
      window.location.assign(url);
    },

    /** Sends the Owner to checkout to add a first card (Free). */
    async addCard() {
      if (seeded()) return;
      const { url } = await post<{ url: string }>("/billing/checkout", {
        plan: "free",
        returnTo: returnTo(),
      });
      window.location.assign(url);
    },
  };
}
