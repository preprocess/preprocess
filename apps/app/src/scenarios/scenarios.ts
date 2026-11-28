/**
 * Seeded UI states for the app's surfaces.
 *
 * Each surface is a small state machine: the selection names which seeded
 * state its data function serves. A surface with a backend has a `live`
 * state, its default, which reads the API; every other state is seeded. Development switches states with the
 * scenario toolbar (or `/api/dev/scenario?set=inbox:empty`), stored in one
 * cookie so the server render and client navigations agree.
 */
export const SCENARIO_COOKIE_NAME = "preprocess-scenario";

export const SCENARIO_SURFACES = {
  inbox: {
    label: "Inbox",
    // "live" reads the API; the rest are seeded.
    states: [
      "seeded",
      "empty",
      "all-read",
      "single-unread",
      "long-copy",
      "live",
    ],
  },
  cases: {
    label: "Cases",
    states: ["live", "seeded", "few", "empty", "load-error"],
  },
  "case-room": {
    label: "Case room",
    states: ["conversation", "empty", "streaming"],
  },
  // The case room's work: fields, answers, checks and run state.
  "case-work": {
    label: "Case work",
    states: [
      "live",
      "waiting",
      "review",
      "approval-tool",
      "approval-completion",
      "approval-decided",
      "running",
      "completed",
      "halted",
      "failed",
      "empty",
    ],
  },
  // Billing settings: "live" reads the API; the rest are seeded plans and
  // states (Design's round-4 frames).
  billing: {
    label: "Billing",
    states: [
      "live",
      "free",
      "free-empty",
      "no-card",
      "team",
      "team-small",
      "team-low",
      "team-empty",
      "team-negative",
      "team-limit",
      "team-past-due",
      "team-reload-failed",
      "team-reload-cap",
      "team-ending",
      "team-switched",
      "enterprise",
      "internal",
      "loading",
    ],
  },
  // How seeded billing actions (top up, upgrade, cancel) answer.
  "billing-result": {
    label: "Billing result",
    states: ["ok", "confirm-payment", "declined", "error"],
  },
  // Retention settings: "live" reads the API; the rest are seeded periods,
  // and "admin" is an Admin's view (shortening disabled).
  retention: {
    label: "Retention",
    states: ["live", "forever", "custom", "admin", "error", "loading"],
  },
  // Single sign-on settings (PRE-137): "live" reads the API; the rest are
  // seeded states named after Design's frames. "admin" is an Admin's
  // read-only view, "member" a Member's 403.
  sso: {
    label: "Single sign-on",
    states: [
      "live",
      "configured",
      "oidc",
      "empty",
      "test-passed",
      "test-failed",
      "required",
      "admin",
      "expired",
      "locked",
      "locked-selfhost",
      "member",
      "loading",
      "error",
    ],
  },
  // Directory sync settings (PRE-138): "live" reads the API; the rest are
  // seeded states named after Design's frames. "admin" is an Admin's
  // read-only view, "member" a Member's 403.
  "directory-sync": {
    label: "Directory sync",
    states: [
      "live",
      "never",
      "synced",
      "syncing",
      "group-removed",
      "token-created",
      "regenerate",
      "revoke",
      "admin",
      "expired",
      "locked",
      "locked-selfhost",
      "member",
      "loading",
      "error",
    ],
  },
  // Settings → Models: "live" reads the API; the rest are seeded catalogues,
  // roles and failures (PRE-145's frames).
  models: {
    label: "Models",
    states: [
      "live",
      "owner",
      "member",
      "empty",
      "member-empty",
      "self-hosted",
      "error",
      "no-access",
      "loading",
    ],
  },
  // License settings (self-hosted): "live" reads the API; the rest are
  // seeded license states, and "admin" is an Admin's read-only view.
  license: {
    label: "License",
    states: ["live", "active", "grace", "expired", "invalid", "none", "admin"],
  },
  // The sidebar notice stack's billing and license state, role and
  // announcements.
  notices: {
    label: "Notices",
    states: [
      "live",
      "one",
      "several",
      "mixed",
      "reload-failed",
      "reload-cap",
      "license-grace",
      "license-expired",
      "license-invalid",
      "member",
      "none",
    ],
  },
  // An agent's Training tab and dataset page: "live" reads the API; the rest
  // are seeded, "operator" is a person who can see the cases but not export,
  // and "off" is an install with the training switch off.
  training: {
    label: "Training",
    states: [
      "live",
      "seeded",
      "operator",
      "off",
      "empty",
      "no-matches",
      "loading",
      "error",
      "no-access",
    ],
  },
} as const;

export type ScenarioSurface = keyof typeof SCENARIO_SURFACES;

export type ScenarioState<S extends ScenarioSurface = ScenarioSurface> =
  (typeof SCENARIO_SURFACES)[S]["states"][number];

export type ScenarioSelection = {
  readonly [S in ScenarioSurface]: ScenarioState<S>;
};

export const SCENARIO_SURFACE_IDS = Object.keys(
  SCENARIO_SURFACES,
) as ScenarioSurface[];

/** Development default: the API where a surface has one, else seeded. */
export const SEEDED_SCENARIO: ScenarioSelection = {
  inbox: "seeded",
  cases: "live",
  "case-room": "conversation",
  "case-work": "live",
  billing: "live",
  "billing-result": "ok",
  retention: "live",
  sso: "live",
  "directory-sync": "live",
  models: "live",
  license: "live",
  notices: "live",
  training: "live",
};

/** Builds without `import.meta.env.DEV` never serve seeded records. */
export const UNSEEDED_SCENARIO: ScenarioSelection = {
  inbox: "live",
  cases: "live",
  "case-room": "empty",
  "case-work": "live",
  billing: "live",
  "billing-result": "ok",
  retention: "live",
  sso: "live",
  "directory-sync": "live",
  models: "live",
  license: "live",
  notices: "live",
  training: "live",
};

export function isScenarioSurface(value: string): value is ScenarioSurface {
  return (SCENARIO_SURFACE_IDS as readonly string[]).includes(value);
}

export function isScenarioState<S extends ScenarioSurface>(
  surface: S,
  value: string,
): value is ScenarioState<S> {
  return (SCENARIO_SURFACES[surface].states as readonly string[]).includes(
    value,
  );
}

/**
 * Applies `surface:state` pairs (comma separated) over `base`. Unknown
 * surfaces or states are ignored so a stale cookie never breaks a page.
 */
export function parseScenario(
  raw: string | undefined | null,
  base: ScenarioSelection = SEEDED_SCENARIO,
): ScenarioSelection {
  const next: Record<string, string> = { ...base };
  if (!raw) return base;
  for (const pair of decodeURIComponent(raw).split(",")) {
    const [surface, state] = pair.split(":").map((part) => part.trim());
    if (!surface || !state || !isScenarioSurface(surface)) continue;
    if (isScenarioState(surface, state)) next[surface] = state;
  }
  return next as ScenarioSelection;
}

/** Only states that differ from the seeded default, in surface order. */
export function serializeScenario(selection: ScenarioSelection): string {
  return SCENARIO_SURFACE_IDS.filter(
    (surface) => selection[surface] !== SEEDED_SCENARIO[surface],
  )
    .map((surface) => `${surface}:${selection[surface]}`)
    .join(",");
}

export function withScenarioState<S extends ScenarioSurface>(
  selection: ScenarioSelection,
  surface: S,
  state: ScenarioState<S>,
): ScenarioSelection {
  return { ...selection, [surface]: state };
}

/** The value of one cookie in a `Cookie` header or `document.cookie`. */
export function readCookie(
  header: string | null | undefined,
  name: string,
): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}
