import {
  parseAgentId,
  parseCaseId,
  type AgentId,
  type CaseId,
} from "./agent-case-ref";

export type OrganizationId = string & { readonly __brand: "OrganizationId" };

export class InvalidOrganizationIdError extends Error {
  readonly value: string;
  constructor(value: string) {
    super("Invalid organization id");
    this.name = "InvalidOrganizationIdError";
    this.value = value;
  }
}

/** 1–128 chars. Same charset as agent/case ids. */
const ORGANIZATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function parseOrganizationId(raw: string): OrganizationId {
  if (!ORGANIZATION_ID.test(raw)) {
    throw new InvalidOrganizationIdError(raw);
  }
  return raw as OrganizationId;
}

/**
 * Listed in the order the case list groups them. Active: the agent is
 * working it. Waiting: it needs people, the teams in `awaiting` (a review
 * is one of these). Done: finished.
 */
export const CASE_STATUSES = ["Waiting", "Active", "Done"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Teams a case can be waiting on. */
export const CASE_GROUPS = [
  "Legal",
  "Sales",
  "Review",
  "Support",
  "Compliance",
  "Finance",
  "Ops",
  "Security",
  "Engineering",
  "Design",
  "People",
  "Counsel",
] as const;
export type CaseGroup = (typeof CASE_GROUPS)[number];

export type CaseAssignee = {
  readonly name: string;
  readonly email: string;
  /** The groups this person belongs to, which they can act for. */
  readonly groups: readonly CaseGroup[];
};

export type Case = {
  readonly id: CaseId;
  readonly agentId: AgentId;
  readonly orgId: OrganizationId;
  /** Optional metadata; many cases have none. Show `caseTitle` instead. */
  readonly title: string | null;
  readonly status: CaseStatus;
  /** Teams the case is waiting on. Empty when it waits on no one. */
  readonly awaiting: readonly CaseGroup[];
  /** Everyone assigned; empty when nobody is. */
  readonly assignees: readonly CaseAssignee[];
  readonly externalId: string | null;
  /** What the agent's runs on this case have cost so far, in US cents. */
  readonly costCents: number;
  /**
   * The branch of the preview deployment that ran it; null for production.
   * Preview cases stay out of inboxes and out of the agents' stats.
   */
  readonly previewBranch: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

const teamList = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
});

/**
 * How a case's awaiting tag reads. A case waits on every team it lists, so
 * the teams join with "and": "Awaiting Legal", "Awaiting Legal and Sales".
 * Null when it waits on no one. (Only the filter chip says "one of", since
 * there several teams mean any of them.)
 */
export function awaitingPhrase(groups: readonly string[]): string | null {
  if (groups.length === 0) return null;
  return `Awaiting ${teamList.format(groups)}`;
}

/**
 * What a case is called wherever it's shown: its title, else its external
 * ID, else its own ID. Titles are optional metadata.
 */
export function caseTitle(item: Pick<Case, "title" | "externalId" | "id">) {
  return item.title ?? item.externalId ?? item.id;
}

/** The ID a case is known by: the external one when it has one. */
export function caseDisplayId(item: Pick<Case, "externalId" | "id">) {
  return item.externalId ?? item.id;
}

/**
 * The groups a case is waiting on with no one from them assigned. A case is
 * waiting on a group so someone from it acts; until someone from each
 * group is assigned, the case needs assignment.
 */
export function unassignedGroups(
  item: Pick<Case, "awaiting" | "assignees">,
): CaseGroup[] {
  return item.awaiting.filter(
    (group) => !item.assignees.some((person) => person.groups.includes(group)),
  );
}

/** "No one from Legal is assigned", or null when every group is covered. */
export function needsAssignmentPhrase(
  item: Pick<Case, "awaiting" | "assignees">,
): string | null {
  const groups = unassignedGroups(item);
  if (groups.length === 0) return null;
  return `No one from ${teamList.format(groups)} is assigned`;
}

export function isCaseStatus(value: string): value is CaseStatus {
  return (CASE_STATUSES as readonly string[]).includes(value);
}

export function isCaseGroup(value: string): value is CaseGroup {
  return (CASE_GROUPS as readonly string[]).includes(value);
}

export type CaseList = {
  readonly data: readonly Case[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
};

export class CaseContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CaseContractError(`Case.${field} must be a non-empty string.`);
  }
  return value;
}

function readStatus(value: unknown): CaseStatus {
  const status = readString(value, "status");
  if (!isCaseStatus(status)) {
    throw new CaseContractError("Case.status is invalid.");
  }
  return status;
}

function readAwaiting(value: unknown): CaseGroup[] {
  if (!Array.isArray(value)) {
    throw new CaseContractError("Case.awaiting must be an array.");
  }
  return value.map((group) => {
    if (typeof group !== "string" || !isCaseGroup(group)) {
      throw new CaseContractError("Case.awaiting has an unknown group.");
    }
    return group;
  });
}

function readAssignees(value: unknown): CaseAssignee[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new CaseContractError("Case.assignees must be an array.");
  }
  return value.map((assignee) => {
    if (!isRecord(assignee)) {
      throw new CaseContractError("Case.assignees has an invalid entry.");
    }
    return {
      name: readString(assignee.name, "assignees.name"),
      email: readString(assignee.email, "assignees.email"),
      groups: Array.isArray(assignee.groups)
        ? assignee.groups.filter(
            (group): group is CaseGroup =>
              typeof group === "string" && isCaseGroup(group),
          )
        : [],
    };
  });
}

function readCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new CaseContractError(
      "Case.costCents must be a whole number of cents.",
    );
  }
  return value;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** Cents as dollars: 124 → "$1.24". */
export function formatCost(cents: number): string {
  return usd.format(cents / 100);
}

export function decodeCase(value: unknown): Case {
  if (!isRecord(value)) {
    throw new CaseContractError("Case must be an object.");
  }
  return {
    id: parseCaseId(readString(value.id, "id")),
    agentId: parseAgentId(readString(value.agentId, "agentId")),
    orgId: parseOrganizationId(readString(value.orgId, "orgId")),
    title:
      value.title === null || value.title === undefined || value.title === ""
        ? null
        : readString(value.title, "title"),
    status: readStatus(value.status),
    awaiting: readAwaiting(value.awaiting),
    assignees: readAssignees(value.assignees),
    costCents: readCents(value.costCents),
    previewBranch:
      value.previewBranch === null || value.previewBranch === undefined
        ? null
        : readString(value.previewBranch, "previewBranch"),
    externalId:
      value.externalId === null || value.externalId === undefined
        ? null
        : readString(value.externalId, "externalId"),
    createdAt: readString(value.createdAt, "createdAt"),
    updatedAt: readString(value.updatedAt, "updatedAt"),
  };
}

export function decodeCaseList(value: unknown): CaseList {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new CaseContractError("CaseList.data must be an array.");
  }
  if (value.nextCursor !== null && typeof value.nextCursor !== "string") {
    throw new CaseContractError(
      "CaseList.nextCursor must be a string or null.",
    );
  }
  if (typeof value.hasMore !== "boolean") {
    throw new CaseContractError("CaseList.hasMore must be a boolean.");
  }
  return {
    data: value.data.map(decodeCase),
    nextCursor: value.nextCursor,
    hasMore: value.hasMore,
  };
}
