import { createServerFn } from "@tanstack/react-start";

import { parseAgentId, parseCaseId } from "./agent-case-ref";
import {
  CASE_STATUSES,
  parseOrganizationId,
  type Case,
  type CaseStatus,
} from "./case";
import type { CasesInboxSearch } from "./case-inbox-search";
import type {
  ApprovalDecision,
  CaseRoomState,
  RoomApproval,
  WriteResult,
} from "./case-room-state";

/**
 * The case list and the case room from /v1, as server functions. The data
 * functions (`list-org-cases.ts`, `case-room-data.ts`) call these when the
 * scenario is live, and serve seeded states otherwise.
 */

type ApiStatus =
  | "queued"
  | "running"
  | "waiting"
  | "halted"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * How the list groups the API's statuses. A halted case needs a person to
 * rerun it once the limit changes, so it waits; a failed or cancelled one is
 * over.
 */
const API_STATUSES: Record<CaseStatus, readonly ApiStatus[]> = {
  Waiting: ["waiting", "halted"],
  Active: ["queued", "running"],
  Done: ["completed", "failed", "cancelled"],
};

const appStatus = (status: ApiStatus): CaseStatus =>
  CASE_STATUSES.find((s) => API_STATUSES[s].includes(status)) ?? "Active";

type ApiGroup = { id: string; slug: string; name: string };

type ApiCaseSummary = {
  id: string;
  agent: { id: string; slug: string };
  deployment: {
    id: string;
    environment: "production" | "preview";
    branch: string | null;
  };
  status: ApiStatus;
  waitingOn: ApiGroup | null;
  assignees: { id: string; name: string }[];
  title: string | null;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
};

type ApiCaseList = {
  items: ApiCaseSummary[];
  nextCursor: string | null;
  counts: Record<ApiStatus, number>;
};

type ApiMember = {
  userId: string;
  name: string;
  email: string;
  groups: ApiGroup[];
};

/** The API's filters for one list query. */
type ListQuery = {
  readonly status?: readonly ApiStatus[];
  readonly agent?: readonly string[];
  readonly waitingOn?: readonly string[];
};

/** What `list-org-cases.ts` renders, as the API serves it. */
export type LiveCaseListPage = {
  readonly rows: readonly Case[];
  readonly groups: readonly { key: string; total: number }[];
  readonly total: number;
  readonly nextCursor: string | null;
  readonly agents: readonly string[];
  readonly counts: {
    readonly status: Readonly<Record<string, number>>;
    readonly agent: Readonly<Record<string, number>>;
    readonly awaiting: Readonly<Record<string, number>>;
    readonly unassigned: Readonly<Record<string, number>>;
  };
  readonly awaitingOptions: readonly string[];
  readonly hasCases: boolean;
};

const server = () => import("../../server/api.server");

async function getJson<T>(path: string): Promise<T> {
  const { activeOrgJson } = await server();
  return activeOrgJson<T>(path);
}

async function send(path: string, init: RequestInit = {}) {
  const { activeOrgRequest } = await server();
  return activeOrgRequest(path, init);
}

/** The API's error code and message, or a plain one when it sent none. */
async function apiError(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  return {
    code: body?.error?.code ?? String(response.status),
    message: body?.error?.message ?? `The request failed (${response.status}).`,
  };
}

const sum = (
  counts: Record<ApiStatus, number>,
  statuses: readonly ApiStatus[],
) => statuses.reduce((total, status) => total + (counts[status] ?? 0), 0);

const peopleById = (members: readonly ApiMember[]) =>
  new Map(members.map((member) => [member.userId, member]));

/** A case as the list shows it; people give assignees their email and groups. */
function toCase(
  organizationId: string,
  item: ApiCaseSummary,
  people: ReadonlyMap<string, ApiMember>,
): Case {
  return {
    id: parseCaseId(item.id),
    agentId: parseAgentId(item.agent.slug),
    orgId: parseOrganizationId(organizationId),
    title: item.title || null,
    status: appStatus(item.status),
    awaiting: item.waitingOn ? [item.waitingOn.name] : [],
    assignees: item.assignees.map((assignee) => {
      const person = people.get(assignee.id);
      return {
        name: assignee.name,
        email: person?.email ?? "",
        groups: person?.groups.map((group) => group.name) ?? [],
      };
    }),
    externalId: null,
    costCents: Math.round(item.costUsd * 100),
    previewBranch:
      item.deployment.environment === "preview"
        ? (item.deployment.branch ?? "preview")
        : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/** The statuses the tab shows. */
const viewStatuses = (search: CasesInboxSearch) =>
  CASE_STATUSES.filter(
    (status) => search.view === "all" || search.view === status.toLowerCase(),
  );

/** The statuses the tab and the Status filter leave in. */
const shownStatuses = (search: CasesInboxSearch) =>
  viewStatuses(search).filter(
    (status) => search.status.length === 0 || search.status.includes(status),
  );

const apiStatuses = (statuses: readonly CaseStatus[]) =>
  statuses.flatMap((status) => API_STATUSES[status]);

type ListCursor = { readonly group: number; readonly cursor: string | null };

function readCursor(raw: string | null): ListCursor {
  if (!raw) return { group: 0, cursor: null };
  try {
    const parsed = JSON.parse(atob(raw)) as ListCursor;
    return { group: Number(parsed.group) || 0, cursor: parsed.cursor ?? null };
  } catch {
    return { group: 0, cursor: null };
  }
}

/**
 * One batch of the list. The API orders by time alone, so each group of the
 * list (a status, an agent, or everything) is its own query, walked in group
 * order; the cursor holds the group and the API's cursor within it. Totals
 * and facet counts come from the API's per-status counts. The API can't yet
 * filter for cases waiting on no one or needing assignment, so the live list
 * doesn't offer those filters.
 */
export const liveCaseList = createServerFn({ method: "GET" })
  .validator(
    (input: {
      search: CasesInboxSearch;
      cursor: string | null;
      collapsed: string[];
      limit: number;
    }) => input,
  )
  .handler(async ({ data }): Promise<LiveCaseListPage> => {
    const { search, collapsed, limit } = data;
    const { activeOrganizationId } = await server();
    const [organizationId, orgGroups, agents, members] = await Promise.all([
      activeOrganizationId(),
      getJson<ApiGroup[]>("/groups"),
      getJson<{ slug: string }[]>("/agents"),
      getJson<ApiMember[]>("/members"),
    ]);
    const people = peopleById(members);
    const environment = search.env === "previews" ? "preview" : "production";

    const list = (
      query: ListQuery & { q?: string },
      size: number,
      cursor?: string | null,
    ) => {
      const params = new URLSearchParams({
        environment,
        sort: search.sort,
        dir: search.dir,
        limit: String(size),
      });
      if (query.q) params.set("q", query.q);
      if (query.status?.length) params.set("status", query.status.join(","));
      if (query.agent?.length) params.set("agent", query.agent.join(","));
      if (query.waitingOn?.length)
        params.set("waitingOn", query.waitingOn.join(","));
      if (cursor) params.set("cursor", cursor);
      return getJson<ApiCaseList>(`/cases?${params}`);
    };
    const q = search.q.trim() || undefined;
    const counts = async (query: ListQuery & { q?: string }) =>
      (await list(query, 1)).counts;

    const view = apiStatuses(viewStatuses(search));
    const shown = shownStatuses(search);
    const statuses = apiStatuses(shown);
    const filters = {
      q,
      agent: search.agent,
      waitingOn: orgGroups
        .filter((group) => search.awaiting.includes(group.name))
        .map((group) => group.slug),
    };
    const slugs = agents.map((agent) => agent.slug);

    const [unfiltered, searched, byAgent, byGroup, filtered, agentTotals] =
      await Promise.all([
        counts({}),
        counts({ q }),
        Promise.all(slugs.map((slug) => counts({ q, agent: [slug] }))),
        Promise.all(
          orgGroups.map((group) => counts({ q, waitingOn: [group.slug] })),
        ),
        counts(filters),
        search.group === "agent"
          ? Promise.all(
              (search.agent.length ? search.agent : slugs).map(
                async (slug) => ({
                  slug,
                  total: sum(
                    await counts({ ...filters, agent: [slug] }),
                    statuses,
                  ),
                }),
              ),
            )
          : Promise.resolve([]),
      ]);

    const groups: { key: string; total: number; query: ListQuery }[] =
      search.group === "status"
        ? shown.map((status) => ({
            key: status,
            total: sum(filtered, API_STATUSES[status]),
            query: { ...filters, status: API_STATUSES[status] },
          }))
        : search.group === "agent"
          ? agentTotals.map(({ slug, total }) => ({
              key: slug,
              total,
              query: { ...filters, agent: [slug], status: statuses },
            }))
          : [
              {
                key: "all",
                total: sum(filtered, statuses),
                query: { ...filters, status: statuses },
              },
            ];
    const listed = groups.filter((group) => group.total > 0);

    const rows: Case[] = [];
    let at = readCursor(data.cursor);
    let nextCursor: string | null = null;
    while (at.group < listed.length) {
      const group = listed[at.group];
      if (collapsed.includes(group.key)) {
        at = { group: at.group + 1, cursor: null };
        continue;
      }
      if (rows.length >= limit) {
        nextCursor = btoa(JSON.stringify(at));
        break;
      }
      const page = await list(group.query, limit - rows.length, at.cursor);
      rows.push(
        ...page.items.map((item) => toCase(organizationId, item, people)),
      );
      at = page.nextCursor
        ? { group: at.group, cursor: page.nextCursor }
        : { group: at.group + 1, cursor: null };
    }

    return {
      rows,
      groups: listed.map(({ key, total }) => ({ key, total })),
      total: listed.reduce((total, group) => total + group.total, 0),
      nextCursor,
      agents: slugs.filter((_, index) =>
        Object.values(byAgent[index]).some((n) => n > 0),
      ),
      counts: {
        status: Object.fromEntries(
          viewStatuses(search).map((status) => [
            status,
            sum(searched, API_STATUSES[status]),
          ]),
        ),
        agent: Object.fromEntries(
          slugs.map((slug, index) => [slug, sum(byAgent[index], view)]),
        ),
        awaiting: Object.fromEntries(
          orgGroups.map((group, index) => [
            group.name,
            sum(byGroup[index], view),
          ]),
        ),
        unassigned: {},
      },
      awaitingOptions: orgGroups.map((group) => group.name),
      hasCases: Object.values(unfiltered).some((n) => n > 0),
    };
  });

/** One case as the list shows it, or null when the caller can't see it. */
export const liveCase = createServerFn({ method: "GET" })
  .validator((caseId: string) => caseId)
  .handler(async ({ data: caseId }): Promise<Case | null> => {
    const { activeOrganizationId } = await server();
    const find = (environment: string) =>
      getJson<ApiCaseList>(
        `/cases?${new URLSearchParams({ q: caseId, environment, limit: "1" })}`,
      );
    const [organizationId, members, production, preview] = await Promise.all([
      activeOrganizationId(),
      getJson<ApiMember[]>("/members"),
      find("production"),
      find("preview"),
    ]);
    const item = [...production.items, ...preview.items].find(
      (candidate) => candidate.id === caseId,
    );
    return item ? toCase(organizationId, item, peopleById(members)) : null;
  });

type ApiRoom = Partial<Omit<CaseRoomState, "approvals">> & {
  status: CaseRoomState["status"];
  approvals?: Omit<RoomApproval, "decidedByName">[];
};

/** Fills what a queued case's room leaves out, and names who decided. */
async function roomOf(room: ApiRoom): Promise<CaseRoomState> {
  const approvals = room.approvals ?? [];
  const people = peopleById(
    approvals.some((approval) => approval.decidedBy)
      ? await getJson<ApiMember[]>("/members")
      : [],
  );
  return {
    status: room.status,
    run: room.run ?? 0,
    waitingOn: room.waitingOn ?? null,
    reason: room.reason ?? null,
    fields: room.fields ?? [],
    checks: room.checks ?? [],
    answers: room.answers ?? null,
    thread: room.thread ?? [],
    approvals: approvals.map((approval) => ({
      ...approval,
      decidedByName: approval.decidedBy
        ? (people.get(approval.decidedBy.replace(/^person:/, ""))?.name ?? null)
        : null,
    })),
  };
}

/**
 * The case room's work as JSON text: answers and payloads are any JSON, which
 * server functions can't type, so the room crosses as text.
 */
const caseRoomJson = createServerFn({ method: "GET" })
  .validator((caseId: string) => caseId)
  .handler(async ({ data: caseId }): Promise<string> => {
    const response = await send(`/cases/${encodeURIComponent(caseId)}/room`);
    if (response.status === 404)
      return JSON.stringify(await roomOf({ status: "queued" }));
    if (!response.ok) throw new Error((await apiError(response)).message);
    return JSON.stringify(await roomOf(await response.json()));
  });

/** The case room's work: fields, answers, checks, thread and approvals. */
export async function liveCaseRoom(caseId: string): Promise<CaseRoomState> {
  return JSON.parse(await caseRoomJson({ data: caseId })) as CaseRoomState;
}

/** Changes an answer: edit it, confirm it, or accept the agent's suggestion. */
export const liveAnswerWrite = createServerFn({ method: "POST" })
  .validator(
    (input: {
      caseId: string;
      kind: "edit" | "confirm" | "accept";
      path: string;
      version: number;
      value?: unknown;
    }) => input,
  )
  .handler(async ({ data }): Promise<WriteResult> => {
    const answers = `/cases/${encodeURIComponent(data.caseId)}/answers`;
    const response = await send(
      data.kind === "edit" ? answers : `${answers}/${data.kind}`,
      {
        method: data.kind === "edit" ? "PATCH" : "POST",
        body: JSON.stringify(
          data.kind === "edit"
            ? { path: data.path, version: data.version, value: data.value }
            : { path: data.path, version: data.version },
        ),
      },
    );
    if (response.ok) {
      const { result } = await response.json<{
        result: { result: "ok" | "suggested" | "unchanged"; stale?: string[] };
      }>();
      return { result: result.result, stale: result.stale ?? [] };
    }
    const error = await apiError(response);
    if (error.code === "version_conflict")
      return {
        result: "conflict",
        version: Number(/version ([0-9]+)/.exec(error.message)?.[1] ?? 0),
      };
    return { result: "refused", reason: error.message };
  });

/** Reruns or cancels the case. */
export const liveCaseCommand = createServerFn({ method: "POST" })
  .validator((input: { caseId: string; command: "rerun" | "cancel" }) => input)
  .handler(async ({ data }) => {
    const response = await send(
      `/cases/${encodeURIComponent(data.caseId)}/${data.command}`,
      { method: "POST" },
    );
    if (!response.ok) throw new Error((await apiError(response)).message);
    return null;
  });

/**
 * Approves, with an optional note, or rejects, with a reason. Refusals come
 * back as data so the room shows them beside the approval.
 */
export const liveApprovalDecision = createServerFn({ method: "POST" })
  .validator(
    (input: {
      caseId: string;
      approvalId: string;
      decision: "approve" | "reject";
      text: string;
    }) => input,
  )
  .handler(async ({ data }): Promise<ApprovalDecision> => {
    const text = data.text.trim();
    const response = await send(
      `/cases/${encodeURIComponent(data.caseId)}/approvals/${encodeURIComponent(data.approvalId)}/${data.decision}`,
      {
        method: "POST",
        body: JSON.stringify(
          data.decision === "reject"
            ? { reason: text }
            : text
              ? { note: text }
              : {},
        ),
      },
    );
    if (response.ok) return { ok: true };
    return { ok: false, ...(await apiError(response)) };
  });
