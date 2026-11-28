import { createServerFn } from "@tanstack/react-start";

import { ApiError, orgApi } from "../auth/client";
import { safeRedirect } from "../auth/safe-redirect";

// Every plan, Free included, starts at Autumn's checkout, which takes a card
// (spec 16a). Where billing is off, or before it holds for the organization,
// the API answers 404, and these give null.

/** Checkout for Free in a new organization, or null to carry on. */
export async function freeCheckout(organizationId: string, next: string) {
  try {
    const { url } = await orgApi<{ url: string }>(
      organizationId,
      "/billing/checkout",
      {
        method: "POST",
        body: JSON.stringify({
          plan: "free",
          returnTo: `${window.location.origin}${next}`,
        }),
      },
    );
    return url;
  } catch (cause) {
    if (cause instanceof ApiError && [404, 409].includes(cause.status))
      return null;
    throw cause;
  }
}

/**
 * Checkout for an organization that has to start a plan before it can work,
 * when the person is its Owner; otherwise null.
 */
export const loadRequiredCheckout = createServerFn({ method: "GET" })
  .validator((next: string) => safeRedirect(next))
  .handler(async ({ data: next }): Promise<string | null> => {
    const { activeOrgRequest } = await import("../../server/api.server");
    const billing = await activeOrgRequest("/billing");
    if (!billing.ok) return null;
    const { started, required } = await billing.json<{
      started: boolean;
      required: boolean;
    }>();
    if (started || !required) return null;
    const { getRequest } = await import("@tanstack/react-start/server");
    const checkout = await activeOrgRequest("/billing/checkout", {
      method: "POST",
      body: JSON.stringify({
        plan: "free",
        returnTo: `${new URL(getRequest().url).origin}${next}`,
      }),
    });
    if (!checkout.ok) return null;
    return (await checkout.json<{ url: string }>()).url;
  });
