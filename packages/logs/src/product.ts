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
const SANDBOX_SIZES = ["small", "medium", "large"] as const;
// The SDK's presets, python-data as python_data.
const SANDBOX_PRESETS = ["standard", "node", "python", "python_data"] as const;

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
  // The marketing site's first-touch utm_* params and referring hostname,
  // lowercased, when the sign-up came through its link (apps/api auth.ts).
  // utm_content is left out: the catalogue test rejects "content" names.
  signed_up: {
    method: ["email", "google", "sso", "directory"],
    utm_source: SLUG,
    utm_medium: SLUG,
    utm_campaign: SLUG,
    utm_term: SLUG,
    referrer_domain: SLUG,
  },
  org_created: {},
  member_invited: { invitation_id: ID, role: ROLES },
  member_joined: {
    member_user_id: ID,
    role: ROLES,
    via: ["invitation", "added", "provisioned"],
  },
  // Onboarding, collaboration and admin (PRE-160). Each fires on
  // the server once its action commits; the auth ones through withAuth.
  // The first name and the first organization a person saves.
  onboarding_step_completed: { step: ["name", "organization"] },
  // Beside member_joined via invitation: how long the invitation waited.
  invitation_accepted: {
    invitation_id: ID,
    role: ROLES,
    seconds_to_accept: COUNT,
    accept_wait: DURATION_BUCKETS,
  },
  // `left` is a person removing themselves; `deprovisioned` is SCIM.
  member_removed: {
    member_user_id: ID,
    role: ROLES,
    via: ["removed", "left", "deprovisioned"],
  },
  role_changed: { member_user_id: ID, from: ROLES, to: ROLES },
  group_created: { group_id: ID },
  // An agent's access for a group; `none` is the grant removed.
  grant_changed: {
    agent_id: ID,
    group_id: ID,
    access: ["operator", "viewer", "none"],
  },
  // A new connection; saving an existing one again sends nothing.
  sso_configured: { protocol: ["saml", "oidc"] },
  // Directory sync's first token, when none was live.
  scim_enabled: {},
  // `first` is the organization's first key ever, by its audit log.
  api_key_created: { api_key_id: ID, first: FLAG },
  api_key_revoked: { api_key_id: ID },
  audit_exported: { format: ["csv", "ndjson"], days: COUNT },
  // One per period changed; days 0 is kept forever.
  retention_changed: {
    setting: ["cases", "documents", "run_capture", "run_logs"],
    days: COUNT,
    shortened: FLAG,
  },
  dataset_created: { dataset_id: ID, agent_id: ID },
  // One page of an export; cases counts the lines it held.
  dataset_exported: {
    dataset_id: ID,
    agent_id: ID,
    format: ["sft", "preference", "replay"],
    cases: COUNT,
  },
  // `preprocess login`: the person approves the code in the app, then the
  // CLI receives its session. Neither names an organization.
  device_authorized: {},
  cli_login: {},
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
    test: FLAG,
  },
  // A case reaching completed or failed. Its usage is the run's: the agent
  // model's tokens, tool and MCP calls, OCR pages, sandbox time, and the
  // credits its model, decide and OCR calls cost (sandbox time is billed
  // apart). error_class is none for a completed case.
  case_completed: {
    case_id: ID,
    agent_id: ID,
    outcome: ["completed", "failed"],
    error_class: ["none", "timeout", "model_error", "run_failed"],
    duration_ms: COUNT,
    duration_bucket: DURATION_BUCKETS,
    model: SLUG,
    tokens_in: COUNT,
    tokens_out: COUNT,
    credits: COUNT,
    credits_bucket: AMOUNT_BUCKETS,
    tool_calls: COUNT,
    mcp_calls: COUNT,
    sandbox_seconds: COUNT,
    ocr_pages: COUNT,
    test: FLAG,
  },
  case_handed_off: {
    case_id: ID,
    agent_id: ID,
    group_id: ID,
    approval: FLAG,
    test: FLAG,
  },
  // first: the case's first message from a person. response_ms runs from
  // when the case started waiting on its group, or from its creation.
  operator_replied: {
    case_id: ID,
    agent_id: ID,
    mentions: COUNT,
    first: FLAG,
    response_ms: COUNT,
    response_bucket: DURATION_BUCKETS,
    test: FLAG,
  },
  // An approval decided; wait_ms runs from its request.
  review_decided: {
    case_id: ID,
    agent_id: ID,
    decision: ["approved", "rejected"],
    level: ["completion", "field", "tool"],
    wait_ms: COUNT,
    wait_bucket: DURATION_BUCKETS,
    test: FLAG,
  },
  mcp_connected: { mcp_server_id: ID, auth: ["oauth", "none"] },
  // A case's sandbox starting for the first time.
  sandbox_used: {
    case_id: OPTIONAL_ID,
    size: SANDBOX_SIZES,
    preset: [...SANDBOX_PRESETS, "unknown"],
  },
  // Agents and deploys, cases, models and tools (PRE-160). `test` marks a
  // case that runs on a preview deployment.
  agent_setting_changed: {
    agent_id: ID,
    setting: [
      "model",
      "reasoning",
      "ocr",
      "search_cases",
      "timeout_seconds",
      "tool_retries",
      "sandbox_image",
      "evals_on_push",
      "schedule_previews",
    ],
    cleared: FLAG,
  },
  agent_archived: { agent_id: ID },
  // rejected: the deploy failed a check (manifest, groups, model, plan).
  deployment_failed: {
    agent_id: OPTIONAL_ID,
    deployment_id: OPTIONAL_ID,
    source: ["cli", "github", "api"],
    failure: [
      "build_failed",
      "build_timed_out",
      "rejected",
      "environment_build_failed",
    ],
  },
  // Promoted by a person or key; rollback when it is older than the
  // deployment it replaces. A production deploy's own promotion is
  // agent_deployed.
  deployment_promoted: { agent_id: ID, deployment_id: ID, rollback: FLAG },
  secret_added: { secrets: COUNT },
  network_rule_changed: {
    scope: ["organization", "agent"],
    agent_id: OPTIONAL_ID,
    allow: COUNT,
    block: COUNT,
    cleared: FLAG,
  },
  github_repo_linked: { link_id: ID, repository_id: ID, relinked: FLAG },
  case_halted: {
    case_id: ID,
    agent_id: ID,
    cause: ["credit_exhausted", "spending_limit_reached"],
    test: FLAG,
  },
  case_rerun: {
    case_id: ID,
    agent_id: ID,
    from: ["waiting", "halted", "completed", "failed"],
    test: FLAG,
  },
  document_uploaded: {
    file_id: ID,
    mime: ["pdf", "image", "office", "text", "other"],
  },
  approval_requested: {
    case_id: ID,
    agent_id: ID,
    level: ["completion", "field", "tool"],
    group: FLAG,
    test: FLAG,
  },
  operator_assigned: {
    case_id: ID,
    agent_id: ID,
    added: COUNT,
    removed: COUNT,
  },
  // An organization's own models are all `org`: their slugs are names.
  model_selected: {
    model: SLUG,
    scope: ["organization", "agent"],
    agent_id: OPTIONAL_ID,
  },
  // One per MCP server a case called, when the case completes or fails.
  mcp_tool_called: {
    case_id: ID,
    agent_id: ID,
    mcp_server_id: ID,
    calls: COUNT,
    errors: COUNT,
    test: FLAG,
  },
  mcp_auth_failed: { mcp_server_id: ID, step: ["refresh", "sign_in"] },
  sandbox_failed: { case_id: OPTIONAL_ID, size: SANDBOX_SIZES },
  // Reserved: training jobs are hidden for now (2026-11-28), so nothing
  // sends it yet.
  training_job_started: { job_id: ID },
  credits_topped_up: {
    credits: COUNT,
    credits_bucket: AMOUNT_BUCKETS,
    source: ["purchase", "auto_reload", "retry"],
  },
  plan_changed: { from: PLANS, to: PLANS, timing: ["now", "period_end"] },
  // Billing (PRE-160, apps/api routes/billing.ts, spending.ts, auto-reload.ts
  // and auth.ts). Credits are $0.01 each; buckets are amountBucket(credits).
  checkout_started: {
    plan: ["free", "team"],
    credits: COUNT,
    credits_bucket: AMOUNT_BUCKETS,
    paid: FLAG,
  },
  auto_reload_changed: {
    enabled: FLAG,
    below_credits: COUNT,
    add_credits: COUNT,
    add_bucket: AMOUNT_BUCKETS,
    monthly_cap: FLAG,
  },
  // Autumn's signed billing.auto_topup_failed, once recorded.
  auto_reload_failed: {
    cause: ["card_declined", "card", "monthly_cap"],
    credits: COUNT,
    credits_bucket: AMOUNT_BUCKETS,
  },
  spending_limit_set: {
    limit: FLAG,
    limit_credits: COUNT,
    limit_bucket: AMOUNT_BUCKETS,
    loosened: FLAG,
    via: ["settings", "request"],
  },
  // The Owner opened the move from Team to Free; plan_changed to free is
  // the confirmation.
  plan_cancel_started: { seats_over: COUNT, agents_paused: COUNT },
  plan_cancel_withdrawn: { plan: PLANS, instead: PLANS },
  org_deleted: {},
  // Reliability and UI usage (PRE-160).
  // A request a rate limit refused (apps/api rate-limit.ts): at most one
  // event per limit and minute in each isolate, however often the caller
  // retries. The sign-in limit counts per client address, so it carries no
  // organization.
  rate_limited: { scope: ["org", "api_key", "sign_in"] },
  // A sign-in link refused by sign-up protection (apps/api
  // signup-protection.ts): the bot check failed, a new address is a
  // temporary inbox, or the address had its links for the hour. Never the
  // address or its domain, so it carries no person and no organization.
  signup_blocked: { reason: ["bot", "disposable", "rate_limited"] },
  // A failed /v1 request by a member or API key of the organization, once
  // the caller is known; a rate limit's refusal is rate_limited instead.
  // Every server error is sent and one client error in ten, with weight 10,
  // so summing weight counts them. The route is the matched template, as in
  // server_request.
  api_error: {
    route: SLUG,
    method: ["get", "post", "put", "patch", "delete"],
    status: COUNT,
    status_class: ["client_error", "server_error"],
    caller: ["person", "api_key"],
    weight: COUNT,
  },
  // The one browser event: someone opened a main surface of the app, sent
  // with posthog.capture by the app's root route (features/monitoring).
  feature_viewed: {
    surface: [
      "inbox",
      "cases",
      "case_room",
      "case_review",
      "agents",
      "agent_overview",
      "agent_cases",
      "agent_deployments",
      "agent_configuration",
      "agent_access",
      "agent_evaluations",
      "agent_evaluation_run",
      "agent_memories",
      "agent_observability",
      "agent_settings",
      "agent_training",
      "agent_dataset",
      "observability",
      "settings_account",
      "settings_organization",
      "settings_members",
      "settings_groups",
      "settings_billing",
      "settings_models",
      "settings_defaults",
      "settings_guardrails",
      "settings_retention",
      "settings_audit_logs",
      "settings_sso",
      "settings_directory_sync",
      "settings_license",
      "developers_api_keys",
      "developers_github",
      "developers_integrations",
      "developers_secrets",
      "developers_network",
      "developers_sandboxes",
      "developers_opentelemetry",
    ],
  },
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
  agents_count: number;
  cases_30d: number;
  credit_balance_bucket: (typeof AMOUNT_BUCKETS)[number];
  has_sso: boolean;
  self_hosted: boolean;
};

// The person properties a product event may set (PRE-160): `$set` for
// what can change, `$set_once` for what was true when they first came.
// first_seen is an ISO timestamp. Nothing else reaches a person.
export type PersonTraits = {
  $set?: { role?: (typeof ROLES)[number] };
  $set_once?: {
    signup_method?: (typeof PRODUCT_EVENTS)["signed_up"]["method"][number];
    first_seen?: string;
  };
};

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const PERSON_SPECS: Record<string, (value: unknown) => boolean> = {
  role: (value) => validValue(ROLES, value),
  signup_method: (value) => validValue(PRODUCT_EVENTS.signed_up.method, value),
  first_seen: (value) => typeof value === "string" && ISO_TIME.test(value),
};

const personSet = (traits: Record<string, unknown> | undefined) => {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(traits ?? {}))
    if (PERSON_SPECS[key]?.(value)) kept[key] = value;
    else
      console.warn(
        JSON.stringify({ event: "product.person_property_dropped", key }),
      );
  return Object.keys(kept).length ? kept : undefined;
};

// What the run-log queue carries: a finished PostHog event.
export type ProductEvent = {
  uuid: string;
  event: ProductEventName | "$groupidentify" | "$set";
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
// Only signed_up has no organization yet. `person` sets the actor's
// person properties, and only with a person as the actor.
export const productEvent = <N extends ProductEventName>(
  env: PostHogEnv,
  name: N,
  organizationId: string | null,
  actor: string | null,
  properties: ProductProperties<N>,
  person?: PersonTraits,
): ProductEvent => {
  const $set = actor ? personSet(person?.$set) : undefined;
  const $set_once = actor ? personSet(person?.$set_once) : undefined;
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
      ...($set && { $set }),
      ...($set_once && { $set_once }),
      stage: env.STAGE ?? "unknown",
      service: "api",
      $geoip_disable: true,
    },
  };
};

// Another person's properties, such as the role an Admin gave them.
export const personIdentify = (
  userId: string,
  traits: PersonTraits["$set"],
): ProductEvent => ({
  uuid: crypto.randomUUID(),
  event: "$set",
  distinctId: userId,
  timestamp: new Date().toISOString(),
  properties: { $set: personSet(traits) ?? {}, $geoip_disable: true },
});

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
