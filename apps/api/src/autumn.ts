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
  email?: string | null;
  subscriptions: {
    plan_id: string;
    status: string;
    started_at?: number;
    current_period_end?: number | null;
    // A renewal payment failed; the status stays active.
    past_due?: boolean;
  }[];
  flags: Record<string, unknown>;
  balances: Record<
    string,
    {
      granted: number;
      remaining: number;
      usage: number;
      unlimited: boolean;
      breakdown?: {
        id: string;
        plan_id: string | null;
        included_grant: number;
        usage: number;
      }[];
    }
  >;
  billing_controls?: { auto_topups?: AutoTopUp[] };
  payment_method?: {
    card?: {
      brand: string;
      last4: string;
      exp_month: number;
      exp_year: number;
      fingerprint?: string;
    };
  } | null;
  // Expanded on request: totals in dollars, created_at in milliseconds.
  invoices?: {
    id: string;
    status: string;
    total: number;
    currency: string;
    created_at: number;
    hosted_invoice_url?: string | null;
  }[];
};

export type AutumnExpand = "invoices" | "payment_method";

// Autumn's auto top-up: below threshold credits, buy quantity more, at most
// limit dollars a month.
export type AutoTopUp = {
  feature_id: string;
  enabled: boolean;
  threshold: number;
  quantity: number;
  purchase_limit?: {
    limit_type: "amount";
    interval: "month";
    limit: number;
  };
};

// A purchase either charges the card on file or needs the Owner on Stripe's
// page (no card yet, 3-D Secure, a declined card): then payment_url is set.
export type AutumnAttached = {
  payment_url?: string | null;
  required_action?: { code: string; reason: string } | null;
  invoice?: { status: string; total: number; currency: string } | null;
};

export type AutumnPreview = {
  line_items: { description: string; total: number }[];
  total: number;
  currency: string;
  next_cycle?: { starts_at: number; total: number } | null;
};

type Purchase = {
  planId: string;
  // Prepaid quantities by feature, such as credits bought.
  quantities?: Record<string, number>;
  successUrl?: string;
  // A downgrade waits for the end of the billing period.
  atPeriodEnd?: boolean;
  // Always send the customer to the payment page instead of charging the card
  // on file; the card entered there is saved for future charges.
  newCard?: boolean;
};

// Free's $5 of credits is granted once per organization and card, by the
// API itself (billing.ts), never by attaching Free: Autumn grants a plan's
// included credits again on every attach.
const withoutFreeCredits = (planId: string) =>
  planId === "free" && {
    customize: { remove_items: [{ feature_id: "model_credit" }] },
  };

const purchase = (organizationId: string, p: Purchase) => ({
  customer_id: organizationId,
  plan_id: p.planId,
  ...withoutFreeCredits(p.planId),
  ...(p.quantities && {
    feature_quantities: Object.entries(p.quantities).map(
      ([feature_id, quantity]) => ({ feature_id, quantity }),
    ),
  }),
  ...(p.successUrl && { success_url: p.successUrl }),
  ...(p.atPeriodEnd && { plan_schedule: "end_of_cycle" }),
  ...(p.newCard && { redirect_mode: "always" }),
});

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
    customer: (
      organizationId: string,
      name?: string,
      expand: AutumnExpand[] = [],
    ) =>
      call<AutumnCustomer>("customers.get_or_create", {
        customer_id: organizationId,
        ...(name && { name }),
        ...(expand.length > 0 && { expand }),
      }),
    // The payment portal, where the Owner updates the card and the billing
    // email and finds every invoice.
    portal: (organizationId: string, returnUrl: string) =>
      call<{ url: string }>("billing.open_customer_portal", {
        customer_id: organizationId,
        return_url: returnUrl,
      }),
    // Starts a plan once the customer adds a card in a Stripe setup session,
    // since every plan needs one (Free included; Chip, 2026-11-26). Attach's
    // own checkout skips the card for a plan that costs nothing up front.
    checkout: (organizationId: string, planId: string, successUrl: string) =>
      call<{ url: string }>("billing.setup_payment", {
        customer_id: organizationId,
        plan_id: planId,
        ...withoutFreeCredits(planId),
        success_url: successUrl,
      }),
    // A plan change or a credit purchase, charged to the card on file. Also
    // starts a plan that costs nothing without checkout or a card: only for
    // organizations that existed before cards were required, and our own
    // (billing.ts).
    attach: (organizationId: string, p: Purchase) =>
      call<AutumnAttached>("billing.attach", purchase(organizationId, p)),
    // Several plans bought together on one Stripe page or one charge, such as
    // Team with its first credits.
    attachTogether: (
      organizationId: string,
      plans: Omit<Purchase, "successUrl">[],
      successUrl: string,
    ) =>
      call<AutumnAttached>("billing.multi_attach", {
        customer_id: organizationId,
        plans: plans.map((p) => {
          const { customer_id: _, ...plan } = purchase(organizationId, p);
          return plan;
        }),
        success_url: successUrl,
      }),
    // Cancels a plan change waiting for the end of the billing period.
    keep: (organizationId: string, planId: string) =>
      call<AutumnAttached>("billing.update", {
        customer_id: organizationId,
        plan_id: planId,
        cancel_action: "uncancel",
      }),
    // Ends a plan at the end of its billing period with nothing after it, so
    // that period's invoice bills what was used; for a deleted organization.
    // Ending it now (cancel_immediately) issues no invoice for usage billed
    // in arrears, such as seats.
    end: (organizationId: string, planId: string) =>
      call<AutumnAttached>("billing.update", {
        customer_id: organizationId,
        plan_id: planId,
        cancel_action: "cancel_end_of_cycle",
      }),
    // A one-time grant, idempotent by its id for the customer.
    grant: (
      organizationId: string,
      grant: { featureId: string; credits: number; id: string },
    ) =>
      call<unknown>("balances.create", {
        customer_id: organizationId,
        feature_id: grant.featureId,
        included_grant: grant.credits,
        balance_id: grant.id,
      }),
    // Takes back a balance's grant. What was already used from it stays as
    // usage, so it is owed rather than forgiven.
    revoke: (
      organizationId: string,
      balance: { featureId: string; id: string; usage: number },
    ) =>
      call<unknown>("balances.update", {
        customer_id: organizationId,
        feature_id: balance.featureId,
        balance_id: balance.id,
        included_grant: 0,
        remaining: 0 - balance.usage,
      }),
    // What attach() would charge, without charging.
    preview: (organizationId: string, p: Purchase) =>
      call<AutumnPreview>(
        "billing.preview_attach",
        purchase(organizationId, p),
      ),
    setAutoTopUp: (organizationId: string, topUp: AutoTopUp) =>
      call<AutumnCustomer>("customers.update", {
        customer_id: organizationId,
        billing_controls: { auto_topups: [topUp] },
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
