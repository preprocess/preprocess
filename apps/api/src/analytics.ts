import { orgId, withOrg, withoutOrgRead } from "@preprocess/db/client";
import { organization } from "@preprocess/db/schema/auth";
import {
  organizationIdentify,
  productEvent,
  sendProductEvents,
  type ProductEvent,
  type ProductEventName,
  type ProductProperties,
} from "@preprocess/logs";
import { eq } from "drizzle-orm";

import type { Env } from "./env.ts";
import { getPlan } from "./plan.ts";
import { countSeats } from "./seats.ts";

// Product analytics (PRE-156, @preprocess/logs product.ts). Call these after
// the action's transaction commits. Events go through the run-log queue,
// whose consumer sends them to PostHog and retries a failed send; without a
// PostHog key (previews, most self-hosted installs) nothing is queued.
export type ProductMessage = { product: ProductEvent };

export const isProductMessage = (body: unknown): body is ProductMessage =>
  typeof body === "object" && body !== null && "product" in body;

export const track = async (env: Env, events: ProductEvent[]) => {
  if (!env.POSTHOG_KEY || !events.length) return;
  try {
    await env.LOGS.sendBatch(events.map((product) => ({ body: { product } })));
  } catch (error) {
    console.error(
      JSON.stringify({ event: "product.queue_failed", error: String(error) }),
    );
    await sendProductEvents(env, events).catch((failed: unknown) =>
      console.error(
        JSON.stringify({ event: "product.send_failed", error: String(failed) }),
      ),
    );
  }
};

// One event. `actor` is the person who acted; an API key, the platform or
// nobody passes null, and the event is the organization's alone.
export const trackEvent = async <N extends ProductEventName>(
  env: Env,
  name: N,
  organizationId: string | null,
  actor: string | null,
  properties: ProductProperties<N>,
) => {
  const events = [productEvent(env, name, organizationId, actor, properties)];
  await track(env, events);
  if (organizationId) await identifyNow(env, organizationId);
};

// An organization's group properties once an hour per isolate as its events
// arrive, so a group never waits for the daily refresh to have them.
const identifiedAt = new Map<string, number>();
const identifyNow = async (env: Env, organizationId: string) => {
  if (!env.POSTHOG_KEY) return;
  const last = identifiedAt.get(organizationId);
  if (last && Date.now() - last < 3_600_000) return;
  identifiedAt.set(organizationId, Date.now());
  await identifyOrganizations(env, [organizationId]);
};

const traits = async (env: Env, org: string) => {
  const id = orgId(org);
  const [plan, seats, [row]] = await Promise.all([
    getPlan(env, id),
    withOrg(env, id, countSeats),
    withoutOrgRead(env, "analytics: organization", (tx) =>
      tx
        .select({ createdAt: organization.createdAt })
        .from(organization)
        .where(eq(organization.id, org)),
    ),
  ]);
  if (!row) return null;
  return { plan: plan.name, seats, created_at: row.createdAt.toISOString() };
};

// The organization group's plan, seats and created_at: when it is created,
// when people join, when its plan changes, and daily for every organization.
export const identifyOrganizations = async (env: Env, orgs: string[]) => {
  if (!env.POSTHOG_KEY) return;
  const events: ProductEvent[] = [];
  for (const org of orgs) {
    try {
      const found = await traits(env, org);
      if (found) events.push(organizationIdentify(org, found));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "product.identify_failed",
          error: String(error),
        }),
      );
    }
  }
  for (let i = 0; i < events.length; i += 100)
    await track(env, events.slice(i, i + 100));
};

export const identifyAllOrganizations = async (env: Env) => {
  if (!env.POSTHOG_KEY) return;
  const orgs = await withoutOrgRead(env, "analytics: organizations", (tx) =>
    tx.select({ id: organization.id }).from(organization),
  );
  await identifyOrganizations(
    env,
    orgs.map((o) => o.id),
  );
};
