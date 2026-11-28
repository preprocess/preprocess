import type { PostHogEnv } from "./posthog.ts";
import { posthogConfig } from "./posthog.ts";

// Product analytics (PRE-156): the one list of lifecycle events we send to
// PostHog, and what each may carry. Every event fires on the server once the
// action it names has committed, goes through the run-log queue (so a failed
// send is retried, never dropped or sampled) and carries its organization as
// the `organization` group.
//
// Properties are ids, counts, flags and enums only. No case, document,
// prompt or message content, no names and no emails: `productEvent` drops
// any value that isn't one of those shapes, and test/product.test.ts fails
// on a property kind or name that could hold free text.
const ID = "id";
const OPTIONAL_ID = "id?";
const COUNT = "count";
const FLAG = "flag";
// A short lowercase token we didn't list ourselves: a model id, a UTM
// value, a referring domain, a route template. Never a sentence.
const SLUG = "slug";

type Kind =
  typeof ID | typeof OPTIONAL_ID | typeof COUNT | typeof FLAG | typeof SLUG;
export type PropertySpec = Kind | readonly string[];

const ROLES = ["owner", "admin", "member"] as const;
const PLANS = ["free", "team", "enterprise", "internal"] as const;

// Buckets for breakdowns, beside the raw count they summarise.
export const DURATION_BUCKETS = [
  "lt_10s",
  "s10_to_1m",
  "m1_to_10m",
  "m10_to_1h",
  "h1_to_1d",
  "gt_1d",
] as const;
const DURATION_EDGES = [10_000, 60_000, 600_000, 3_600_000, 86_400_000];

export const AMOUNT_BUCKETS = [
  "zero",
  "lt_1",
  "n1_to_10",
  "n10_to_100",
  "n100_to_1k",
  "n1k_to_10k",
  "gt_10k",
] as const;
const AMOUNT_EDGES = [1, 10, 100, 1_000, 10_000];

export const durationBucket = (ms: number) =>
  DURATION_BUCKETS[DURATION_EDGES.filter((edge) => ms >= edge).length]!;

// Credits, tokens, pages: zero apart, then by powers of ten.
export const amountBucket = (amount: number) =>
  amount <= 0
    ? "zero"
    : AMOUNT_BUCKETS[1 + AMOUNT_EDGES.filter((edge) => amount >= edge).length]!;

export const PRODUCT_EVENTS = {
  signed_up: { method: ["email", "google", "sso", "directory"] },
  org_created: {},
  member_invited: { invitation_id: ID, role: ROLES },
  member_joined: {
    member_user_id: ID,
    role: ROLES,
    via: ["invitation", "added", "provisioned"],
  },
  agent_created: { agent_id: ID },
  agent_deployed: {
    agent_id: ID,
    deployment_id: ID,
    source: ["cli", "github", "api"],
    environment: ["production", "preview"],
    custom_environment: FLAG,
  },
  case_started: {
    case_id: ID,
    agent_id: ID,
    deployment_id: ID,
    source: ["api", "app", "mcp", "schedule"],
    files: COUNT,
  },
  case_completed: {
    case_id: ID,
    agent_id: ID,
    outcome: ["completed", "failed"],
  },
  case_handed_off: { case_id: ID, agent_id: ID, group_id: ID, approval: FLAG },
  operator_replied: { case_id: ID, agent_id: ID, mentions: COUNT },
  review_decided: {
    case_id: ID,
    agent_id: ID,
    decision: ["approved", "rejected"],
    level: ["completion", "field", "tool"],
  },
  mcp_connected: { mcp_server_id: ID, auth: ["oauth", "none"] },
  sandbox_used: { case_id: OPTIONAL_ID, size: ["small", "medium", "large"] },
  // Reserved: training jobs are hidden for now (2026-11-28), so nothing
  // sends it yet.
  training_job_started: { job_id: ID },
  credits_topped_up: { credits: COUNT },
  plan_changed: { from: PLANS, to: PLANS, timing: ["now", "period_end"] },
} as const satisfies Record<string, Record<string, PropertySpec>>;

export type ProductEventName = keyof typeof PRODUCT_EVENTS;

type ValueOf<S> = S extends typeof ID
  ? string
  : S extends typeof OPTIONAL_ID
    ? string | null
    : S extends typeof COUNT
      ? number
      : S extends typeof FLAG
        ? boolean
        : S extends typeof SLUG
          ? string
          : S extends readonly (infer V)[]
            ? V
            : never;

export type ProductProperties<N extends ProductEventName> = {
  -readonly [P in keyof (typeof PRODUCT_EVENTS)[N]]: ValueOf<
    (typeof PRODUCT_EVENTS)[N][P]
  >;
};

// The organization group's properties, sent as $groupidentify.
export type OrganizationTraits = {
  plan: string;
  seats: number;
  created_at: string;
};

// What the run-log queue carries: a finished PostHog event.
export type ProductEvent = {
  uuid: string;
  event: ProductEventName | "$groupidentify";
  distinctId: string;
  timestamp: string;
  properties: Record<string, unknown>;
};

const SLUG_VALUE = /^[a-z0-9/][a-z0-9._:/{}-]{0,79}$/;

// Ours: a type prefix and a 26-character base32 body (packages/db ids.ts).
const TYPED_ID = /^[a-z]{2,6}_[0-9a-z]{26}$/;

export const validValue = (spec: PropertySpec, value: unknown) => {
  if (typeof spec !== "string") return spec.includes(value as string);
  if (spec === OPTIONAL_ID && value === null) return true;
  if (spec === ID || spec === OPTIONAL_ID)
    return typeof value === "string" && TYPED_ID.test(value);
  if (spec === COUNT)
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (spec === SLUG) return typeof value === "string" && SLUG_VALUE.test(value);
  return typeof value === "boolean";
};

// One event. The person who acted is its distinct id; an event nobody did
// (a case completing) has the organization's id as its distinct id. Both
// keep a person profile, since PostHog drops groups from personless events.
// The Worker's IP says nothing about the person, so no GeoIP either.
// Only signed_up has no organization yet.
export const productEvent = <N extends ProductEventName>(
  env: PostHogEnv,
  name: N,
  organizationId: string | null,
  actor: string | null,
  properties: ProductProperties<N>,
): ProductEvent => {
  const spec = PRODUCT_EVENTS[name] as Record<string, PropertySpec>;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    const allowed = spec[key];
    if (allowed && validValue(allowed, value)) kept[key] = value;
    else
      console.warn(
        JSON.stringify({ event: "product.property_dropped", name, key }),
      );
  }
  return {
    uuid: crypto.randomUUID(),
    event: name,
    distinctId: actor ?? organizationId ?? "platform",
    timestamp: new Date().toISOString(),
    properties: {
      ...kept,
      ...(organizationId && {
        organization_id: organizationId,
        $groups: { organization: organizationId },
      }),
      stage: env.STAGE ?? "unknown",
      service: "api",
      $geoip_disable: true,
    },
  };
};

// `$group_set` merges, so a change can name only what changed.
export const organizationIdentify = (
  organizationId: string,
  traits: Partial<OrganizationTraits>,
): ProductEvent => ({
  uuid: crypto.randomUUID(),
  event: "$groupidentify",
  distinctId: organizationId,
  timestamp: new Date().toISOString(),
  properties: {
    $group_type: "organization",
    $group_key: organizationId,
    $group_set: traits,
    $geoip_disable: true,
  },
});

// PostHog's /batch/ API. Throws on a failed send so the queue retries it;
// the uuid lets PostHog drop a repeat.
export const sendProductEvents = async (
  env: PostHogEnv,
  events: ProductEvent[],
) => {
  const posthog = posthogConfig(env);
  if (!posthog || !events.length) return;
  const response = await fetch(`${posthog.host.replace(/\/$/, "")}/batch/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: posthog.key,
      batch: events.map((e) => ({
        uuid: e.uuid,
        event: e.event,
        distinct_id: e.distinctId,
        timestamp: e.timestamp,
        properties: { ...e.properties, $lib: "preprocess-server" },
      })),
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error(`PostHog batch failed with ${response.status}`);
};
