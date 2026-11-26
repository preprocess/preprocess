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
  RoomMemory,
  RoomOption,
  WriteResult,
} from "./case-room-state";
import { staleAfterWrite } from "../../lib/data-changed";

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

/** GETs a /v1 route; with `notFound`, a 404 returns it instead of throwing. */
async function getJson<T>(path: string, ...notFound: [] | [T]): Promise<T> {
  const { activeOrgJson } = await server();
  return activeOrgJson<T>(
    path,
    notFound.length > 0 ? { notFound: notFound[0] } : {},
  );
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

    const [unfiltered, byAgent, byGroup, filtered, agentTotals] =
      await Promise.all([
        counts({}),
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
          CASE_STATUSES.map((status) => [
            status,
            sum(filtered, API_STATUSES[status]),
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

type ApiRoom = Partial<Omit<CaseRoomState, "approvals" | "memories">> & {
  status: CaseRoomState["status"];
  approvals?: Omit<RoomApproval, "decidedByName">[];
};

type ApiMemory = Omit<RoomMemory, "decidedByName"> & {
  /** The deciding person's user id. */
  decidedBy: string | null;
};

/**
 * A field's options as the room lists them: the API sends an inline list as
 * `{ kind: "inline", items }` and a searched source as `{ kind: "source" }`,
 * whose options only the search returns.
 */
function inlineOptions(options: unknown): RoomOption[] | null {
  if (Array.isArray(options)) return options as RoomOption[];
  const meta = options as { kind?: string; items?: RoomOption[] } | null;
  return meta?.kind === "inline" ? (meta.items ?? []) : null;
}

/**
 * Fills what a queued case's room leaves out, adds the rules the agent
 * proposed on the case, and names who decided.
 */
async function roomOf(
  room: ApiRoom,
  apiMemories: ApiMemory[],
): Promise<CaseRoomState> {
  const approvals = room.approvals ?? [];
  const people = peopleById(
    approvals.some((approval) => approval.decidedBy) ||
      apiMemories.some((m) => m.decidedBy)
      ? await getJson<ApiMember[]>("/members")
      : [],
  );
  return {
    status: room.status,
    run: room.run ?? 0,
    waitingOn: room.waitingOn ?? null,
    reason: room.reason ?? null,
    fields: (room.fields ?? []).map((field) => ({
      ...field,
      options: inlineOptions(field.options),
    })),
    checks: room.checks ?? [],
    answers: room.answers ?? null,
    thread: room.thread ?? [],
    approvals: approvals.map((approval) => ({
      ...approval,
      decidedByName: approval.decidedBy
        ? (people.get(approval.decidedBy.replace(/^person:/, ""))?.name ?? null)
        : null,
    })),
    memories: apiMemories.map((m) => ({
      id: m.id,
      text: m.text,
      reason: m.reason,
      status: m.status,
      proposedAt: m.proposedAt,
      decidedAt: m.decidedAt,
      decidedByName: m.decidedBy
        ? (people.get(m.decidedBy)?.name ?? null)
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
    const path = `/cases/${encodeURIComponent(caseId)}`;
    const [response, memories] = await Promise.all([
      send(`${path}/room`),
      getJson<{ memories: ApiMemory[] } | null>(`${path}/memories`, null),
    ]);
    const proposals = memories?.memories ?? [];
    if (response.status === 404)
      return JSON.stringify(await roomOf({ status: "queued" }, proposals));
    if (!response.ok) throw new Error((await apiError(response)).message);
    return JSON.stringify(await roomOf(await response.json(), proposals));
  });

/** The case room's work: fields, answers, checks, thread and approvals. */
export async function liveCaseRoom(caseId: string): Promise<CaseRoomState> {
  return JSON.parse(await caseRoomJson({ data: caseId })) as CaseRoomState;
}

/** Changes an answer: edit it, confirm it, or accept the agent's suggestion. */
export const liveAnswerWrite = createServerFn({ method: "POST" })
  .middleware([staleAfterWrite])
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
  .middleware([staleAfterWrite])
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
 * Completes a waiting case as a person. The API refuses with 409 when the case
 * is not waiting or its checks fail; refusals come back as data so the Review
 * tab shows the message beside the button.
 */
export const liveCompleteCase = createServerFn({ method: "POST" })
  .middleware([staleAfterWrite])
  .validator((caseId: string) => caseId)
  .handler(async ({ data: caseId }): Promise<ApprovalDecision> => {
    const response = await send(
      `/cases/${encodeURIComponent(caseId)}/complete`,
      { method: "POST" },
    );
    if (response.ok) return { ok: true };
    return { ok: false, ...(await apiError(response)) };
  });

/**
 * Accepts or dismisses a rule the agent proposed. Refusals come back as data
 * so the Review tab shows them beside the rule.
 */
export const liveMemoryDecision = createServerFn({ method: "POST" })
  .middleware([staleAfterWrite])
  .validator(
    (input: {
      caseId: string;
      memoryId: string;
      decision: "accept" | "dismiss";
    }) => input,
  )
  .handler(async ({ data }): Promise<ApprovalDecision> => {
    const response = await send(
      `/cases/${encodeURIComponent(data.caseId)}/memories/${encodeURIComponent(data.memoryId)}/${data.decision}`,
      { method: "POST" },
    );
    if (response.ok) return { ok: true };
    return { ok: false, ...(await apiError(response)) };
  });

/** Posts to the case thread. Refusals come back as data for the composer. */
export const livePostMessage = createServerFn({ method: "POST" })
  .middleware([staleAfterWrite])
  .validator((input: { caseId: string; text: string }) => input)
  .handler(async ({ data }): Promise<ApprovalDecision> => {
    const response = await send(
      `/cases/${encodeURIComponent(data.caseId)}/messages`,
      { method: "POST", body: JSON.stringify({ text: data.text }) },
    );
    if (response.ok) return { ok: true };
    return { ok: false, ...(await apiError(response)) };
  });

/**
 * Approves, with an optional note, or rejects, with a reason. Refusals come
 * back as data so the room shows them beside the approval.
 */
export const liveApprovalDecision = createServerFn({ method: "POST" })
  .middleware([staleAfterWrite])
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

type ApiOrgMember = ApiMember & { role: "owner" | "admin" | "member" };
type ApiOrgGroup = ApiGroup & { isDevelopers: boolean };
type ApiAgentRef = { id: string; slug: string; archived: boolean };
type ApiGrant = {
  agentSlug: string;
  groupId: string;
  access: "operator" | "viewer";
};

/**
 * What the signed-in person may do to cases, by the API's access rules:
 * Owners and Admins assign, and Developers or an operator group's members
 * start an agent's cases.
 */
export type CaseAccess = {
  readonly canAssign: boolean;
  /** Slugs of the agents whose cases the person may start. */
  readonly startAgents: readonly string[];
};

export const liveCaseAccess = createServerFn({ method: "GET" }).handler(
  async (): Promise<CaseAccess> => {
    const { apiJson } = await server();
    const [session, members, groups, agents] = await Promise.all([
      apiJson<{ user: { id: string } } | null>("/api/auth/get-session"),
      getJson<ApiOrgMember[]>("/members"),
      getJson<ApiOrgGroup[]>("/groups"),
      getJson<ApiAgentRef[]>("/agents"),
    ]);
    const me = members.find((member) => member.userId === session?.user.id);
    if (!me) return { canAssign: false, startAgents: [] };
    const canAssign = me.role === "owner" || me.role === "admin";
    const open = agents.filter((agent) => !agent.archived);
    const mine = new Set(me.groups.map((group) => group.id));
    if (groups.some((group) => group.isDevelopers && mine.has(group.id)))
      return { canAssign, startAgents: open.map((agent) => agent.slug) };
    const grants = (
      await Promise.all(
        [...mine].map((id) =>
          getJson<{ grants: ApiGrant[] }>(`/groups/${encodeURIComponent(id)}`),
        ),
      )
    ).flatMap((detail) => detail.grants);
    const operated = new Set(
      grants
        .filter((grant) => grant.access === "operator")
        .map((grant) => grant.agentSlug),
    );
    return {
      canAssign,
      startAgents: open
        .filter((agent) => operated.has(agent.slug))
        .map((agent) => agent.slug),
    };
  },
);

/** Someone a case can be assigned to. */
export type AssigneeCandidate = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
};

/**
 * The people who can see the agent's cases, the API's rule for assignees:
 * Owners and Admins, Developers, and members of a group with access to it.
 */
export const liveAssigneeCandidates = createServerFn({ method: "GET" })
  .validator((agentSlug: string) => agentSlug)
  .handler(async ({ data: agentSlug }): Promise<AssigneeCandidate[]> => {
    const agent = await getJson<ApiAgentRef>(
      `/agents/${encodeURIComponent(agentSlug)}`,
    );
    const [grants, groups, members] = await Promise.all([
      getJson<ApiGrant[]>(`/agents/${encodeURIComponent(agent.id)}/grants`),
      getJson<ApiOrgGroup[]>("/groups"),
      getJson<ApiOrgMember[]>("/members"),
    ]);
    const access = new Set([
      ...grants.map((grant) => grant.groupId),
      ...groups.filter((group) => group.isDevelopers).map((group) => group.id),
    ]);
    return members
      .filter(
        (member) =>
          member.role === "owner" ||
          member.role === "admin" ||
          member.groups.some((group) => access.has(group.id)),
      )
      .map((member) => ({
        id: member.userId,
        name: member.name,
        email: member.email,
      }));
  });

/** Replaces a case's assignees. Refusals come back as data. */
export const liveSetAssignees = createServerFn({ method: "POST" })
  .middleware([staleAfterWrite])
  .validator((input: { caseId: string; userIds: string[] }) => input)
  .handler(async ({ data }): Promise<ApprovalDecision> => {
    const response = await send(
      `/cases/${encodeURIComponent(data.caseId)}/assignees`,
      { method: "PUT", body: JSON.stringify({ userIds: data.userIds }) },
    );
    if (response.ok) return { ok: true };
    return { ok: false, ...(await apiError(response)) };
  });

/** Stores one file to start a case with; the form carries it as "file". */
export const liveUploadFile = createServerFn({ method: "POST" })
  .middleware([staleAfterWrite])
  .validator((form: FormData) => {
    if (!(form instanceof FormData) || !(form.get("file") instanceof File))
      throw new Error("Send the file as a form.");
    return form;
  })
  .handler(async ({ data: form }): Promise<string> => {
    const response = await send("/files", { method: "POST", body: form });
    if (!response.ok) throw new Error((await apiError(response)).message);
    return (await response.json<{ id: string }>()).id;
  });

/** A file attached to a case; its bytes come from the download route. */
export type CaseFile = {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly createdAt: string;
};

/** The case's files, oldest first. */
export const liveCaseFiles = createServerFn({ method: "GET" })
  .validator((caseId: string) => caseId)
  .handler(async ({ data: caseId }): Promise<CaseFile[]> => {
    const response = await send(`/cases/${encodeURIComponent(caseId)}/files`);
    if (!response.ok) throw new Error((await apiError(response)).message);
    return (await response.json<{ files: CaseFile[] }>()).files;
  });

/**
 * Attaches uploaded files to the case. Refusals (a cancelled case, files that
 * already belong to a case) come back as data for the Input tab.
 */
export const liveAttachFiles = createServerFn({ method: "POST" })
  .middleware([staleAfterWrite])
  .validator((input: { caseId: string; files: string[] }) => input)
  .handler(async ({ data }): Promise<ApprovalDecision> => {
    const response = await send(
      `/cases/${encodeURIComponent(data.caseId)}/files`,
      { method: "POST", body: JSON.stringify({ files: data.files }) },
    );
    if (response.ok) return { ok: true };
    return { ok: false, ...(await apiError(response)) };
  });

/**
 * Starts a case by hand. The key makes a retried submit start one case, not
 * two; each submit sends a fresh one.
 */
export const liveStartCase = createServerFn({ method: "POST" })
  .middleware([staleAfterWrite])
  .validator(
    (input: {
      agent: string;
      text: string;
      files: string[];
      idempotencyKey: string;
    }) => input,
  )
  .handler(async ({ data }): Promise<string> => {
    const response = await send("/cases", {
      method: "POST",
      headers: { "idempotency-key": data.idempotencyKey },
      body: JSON.stringify({
        agent: data.agent,
        ...(data.text && { text: data.text }),
        files: data.files,
      }),
    });
    if (!response.ok) throw new Error((await apiError(response)).message);
    return (await response.json<{ id: string }>()).id;
  });

/** A page of a field's options, searched across its full list. */
export type OptionPage = {
  readonly items: readonly RoomOption[];
  /** Every option the search matches, when the agent's code counts them. */
  readonly total: number | null;
  /** Whether more options match than the page holds. */
  readonly more: boolean;
};

export const OPTION_PAGE_SIZE = 50;

export const liveSearchOptions = createServerFn({ method: "POST" })
  .validator((input: { caseId: string; path: string; query: string }) => input)
  .handler(async ({ data }): Promise<OptionPage> => {
    const response = await send(
      `/cases/${encodeURIComponent(data.caseId)}/options`,
      {
        method: "POST",
        body: JSON.stringify({
          path: data.path,
          ...(data.query && { query: data.query }),
          limit: OPTION_PAGE_SIZE,
        }),
      },
    );
    if (!response.ok) throw new Error((await apiError(response)).message);
    const page = await response.json<{
      items: RoomOption[];
      cursor?: string;
      total?: number;
    }>();
    return {
      items: page.items.map(({ id, label, description }) => ({
        id,
        label,
        ...(description && { description }),
      })),
      total: page.total ?? null,
      more: page.cursor !== undefined,
    };
  });
