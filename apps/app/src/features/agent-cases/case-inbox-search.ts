import { isCaseStatus, type CaseStatus } from "./case";

/**
 * Awaiting and assignment filters hold group names, or these markers. The
 * list's data function offers the groups it knows and ignores any other.
 */
export const AWAITING_NONE = "none";
export type AwaitingFilter = string;

/** Needs assignment from any group, rather than from a given one. */
export const UNASSIGNED_ANY = "any";
export type UnassignedFilter = string;

/** The tabs above the list: every case, then one tab per status. */
export const CASES_VIEWS = ["all", "active", "waiting", "done"] as const;
export type CasesView = (typeof CASES_VIEWS)[number];

export const CASES_GROUPINGS = ["status", "agent", "none"] as const;
export type CasesGrouping = (typeof CASES_GROUPINGS)[number];

export const CASES_SORT_FIELDS = ["updatedAt", "createdAt"] as const;
export type CasesSortField = (typeof CASES_SORT_FIELDS)[number];

export const CASES_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type CasesSortDirection = (typeof CASES_SORT_DIRECTIONS)[number];

/** Production cases, or the ones preview deployments ran (developers only). */
export const CASES_ENVIRONMENTS = ["production", "previews"] as const;
export type CasesEnvironment = (typeof CASES_ENVIRONMENTS)[number];

export type CasesInboxSearch = {
  readonly env: CasesEnvironment;
  readonly view: CasesView;
  readonly group: CasesGrouping;
  readonly q: string;
  readonly agent: readonly string[];
  readonly status: readonly CaseStatus[];
  readonly awaiting: readonly AwaitingFilter[];
  /**
   * Cases that need assignment: "any" for any uncovered group, or the
   * groups that must be the uncovered ones. Several match any of them.
   */
  readonly unassigned: readonly UnassignedFilter[];
  readonly sort: CasesSortField;
  readonly dir: CasesSortDirection;
};

export type CasesSearchParams = {
  env?: CasesEnvironment;
  view?: CasesView;
  group?: CasesGrouping;
  q?: string;
  agent?: string | readonly string[];
  status?: string | readonly string[];
  awaiting?: string | readonly string[];
  unassigned?: string | readonly string[];
  sort?: CasesSortField;
  dir?: CasesSortDirection;
};

export const DEFAULT_CASES_SEARCH: CasesInboxSearch = {
  env: "production",
  view: "all",
  group: "status",
  q: "",
  agent: [],
  status: [],
  awaiting: [],
  unassigned: [],
  sort: "updatedAt",
  dir: "desc",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => asStringList(item));
  }
  return [];
}

function isView(value: unknown): value is CasesView {
  return (
    typeof value === "string" &&
    (CASES_VIEWS as readonly string[]).includes(value)
  );
}

function isGrouping(value: unknown): value is CasesGrouping {
  return (
    typeof value === "string" &&
    (CASES_GROUPINGS as readonly string[]).includes(value)
  );
}

function isSortField(value: unknown): value is CasesSortField {
  return (
    typeof value === "string" &&
    (CASES_SORT_FIELDS as readonly string[]).includes(value)
  );
}

function isSortDirection(value: unknown): value is CasesSortDirection {
  return (
    typeof value === "string" &&
    (CASES_SORT_DIRECTIONS as readonly string[]).includes(value)
  );
}

export function parseCasesSearch(raw: unknown): CasesInboxSearch {
  const record = isRecord(raw) ? raw : {};
  return {
    env: record.env === "previews" ? "previews" : DEFAULT_CASES_SEARCH.env,
    view: isView(record.view) ? record.view : DEFAULT_CASES_SEARCH.view,
    group: isGrouping(record.group) ? record.group : DEFAULT_CASES_SEARCH.group,
    q: typeof record.q === "string" ? record.q : "",
    agent: asStringList(record.agent),
    status: asStringList(record.status).filter(isCaseStatus),
    awaiting: asStringList(record.awaiting),
    unassigned: asStringList(record.unassigned),
    sort: isSortField(record.sort) ? record.sort : DEFAULT_CASES_SEARCH.sort,
    dir: isSortDirection(record.dir) ? record.dir : DEFAULT_CASES_SEARCH.dir,
  };
}

export function casesSearchForUrl(search: CasesInboxSearch): CasesSearchParams {
  const next: CasesSearchParams = {};
  if (search.env !== DEFAULT_CASES_SEARCH.env) next.env = search.env;
  if (search.view !== DEFAULT_CASES_SEARCH.view) next.view = search.view;
  if (search.group !== DEFAULT_CASES_SEARCH.group) next.group = search.group;
  if (search.q.trim()) next.q = search.q;
  if (search.agent.length > 0) next.agent = [...search.agent];
  if (search.status.length > 0) next.status = [...search.status];
  if (search.awaiting.length > 0) next.awaiting = [...search.awaiting];
  if (search.unassigned.length > 0) next.unassigned = [...search.unassigned];
  if (search.sort !== DEFAULT_CASES_SEARCH.sort) next.sort = search.sort;
  if (search.dir !== DEFAULT_CASES_SEARCH.dir) next.dir = search.dir;
  return next;
}

export function patchCasesSearch(
  current: CasesInboxSearch,
  patch: Partial<CasesInboxSearch>,
): CasesInboxSearch {
  return { ...current, ...patch };
}

let lastCasesSearch: CasesInboxSearch = DEFAULT_CASES_SEARCH;

/** The list's search as last shown, so a case room can step through it. */
export function rememberCasesSearch(search: CasesInboxSearch) {
  lastCasesSearch = search;
}

export function rememberedCasesSearch(): CasesInboxSearch {
  return lastCasesSearch;
}
