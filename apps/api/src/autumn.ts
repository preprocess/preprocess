// Autumn (useautumn.com), our cloud's billing service (spec 16a). Plans live
// in autumn.config.ts; this is the little of Autumn's API the platform uses.
// Only our cloud talks to it: a self-hosted install, or a stage without
// AUTUMN_SECRET_KEY, gets null and bills nothing.

import { runMode } from "@preprocess/runmode";

import type { Env } from "./env.ts";

const BASE = "https://api.useautumn.com/v1";

export class AutumnError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type AutumnCustomer = {
  id: string;
  subscriptions: { plan_id: string; status: string }[];
  flags: Record<string, unknown>;
  balances: Record<
    string,
    { granted: number; remaining: number; usage: number; unlimited: boolean }
  >;
};

export type Autumn = ReturnType<typeof client>;

const client = (key: string) => {
  const call = async <T>(
    route: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> => {
    const response = await fetch(`${BASE}/${route}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await response.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
    };
    if (!response.ok)
      throw new AutumnError(
        response.status,
        json.code ?? "autumn_error",
        json.message ?? `Autumn answered ${response.status}`,
      );
    return json as T;
  };
  return {
    // Organizations are Autumn customers under their own id.
    customer: (organizationId: string, name?: string) =>
      call<AutumnCustomer>("customers.get_or_create", {
        customer_id: organizationId,
        ...(name && { name }),
      }),
    // Starts a plan. Always through Autumn's checkout, which collects a card,
    // since every plan needs one (Free included; Chip, 2026-11-26).
    checkout: (organizationId: string, planId: string, successUrl: string) =>
      call<{ payment_url: string | null }>("billing.attach", {
        customer_id: organizationId,
        plan_id: planId,
        redirect_mode: "always",
        success_url: successUrl,
      }),
    // Records usage at the time it happened. A repeated idempotency key is
    // answered 409, which means Autumn already has it.
    track: async (usage: {
      organizationId: string;
      featureId: string;
      value: number;
      at: Date;
      idempotencyKey: string;
    }) => {
      try {
        await call(
          "track",
          {
            customer_id: usage.organizationId,
            feature_id: usage.featureId,
            value: usage.value,
            timestamp: usage.at.getTime(),
          },
          { "idempotency-key": usage.idempotencyKey },
        );
      } catch (error) {
        if (error instanceof AutumnError && error.status === 409) return;
        throw error;
      }
    },
    check: (organizationId: string, featureId: string) =>
      call<{ allowed: boolean }>("check", {
        customer_id: organizationId,
        feature_id: featureId,
      }),
  };
};

export const autumn = (
  env: Pick<Env, "PREPROCESS_REGION" | "AUTUMN_SECRET_KEY">,
): Autumn | null =>
  runMode(env).kind === "cloud" && env.AUTUMN_SECRET_KEY
    ? client(env.AUTUMN_SECRET_KEY)
    : null;
