/**
 * Seeded UI states for surfaces that have no backend yet.
 *
 * Each surface is a small state machine: the selection names which seeded
 * state its data function serves. Development switches states with the
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
    states: ["seeded", "few", "empty", "load-error"],
  },
  "case-room": {
    label: "Case room",
    states: ["conversation", "empty", "streaming"],
  },
  // The case room's work: fields, answers, checks and run state.
  "case-work": {
    label: "Case work",
    states: [
      "waiting",
      "review",
      "running",
      "completed",
      "halted",
      "failed",
      "empty",
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

/** Development default: every surface populated. */
export const SEEDED_SCENARIO: ScenarioSelection = {
  inbox: "seeded",
  cases: "seeded",
  "case-room": "conversation",
  "case-work": "waiting",
};

/** Builds without `import.meta.env.DEV` never serve seeded records. */
export const UNSEEDED_SCENARIO: ScenarioSelection = {
  inbox: "live",
  cases: "empty",
  "case-room": "empty",
  "case-work": "empty",
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
