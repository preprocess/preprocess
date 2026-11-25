import { createServerFn } from "@tanstack/react-start";

import type { InboxLoad } from "./inbox-seed";
import {
  unreadCount,
  type InboxCounts,
  type InboxDetail,
  type InboxItem,
  type MarkReadSelector,
} from "./notification";

/**
 * The inbox from the API (GET /v1/orgs/{org}/inbox), mapped onto the items
 * the inbox UI renders. Item ids are the API's item keys, which read marks
 * take as they are.
 */

type ApiCase = {
  id: string;
  agent: { id: string; slug: string };
  title: string | null;
  status: string;
};

type ApiGuardrailChange =
  | { kind: "network"; hosts: string[] }
  | { kind: "secret"; secret: string }
  | { kind: "mcp"; server: string }
  | { kind: "spending_limit"; limitUsd: number | null };

type ApiInboxItem = {
  key: string;
  kind:
    "waiting" | "mention" | "assigned" | "approval" | "guardrail" | "memory";
  at: string;
  read: boolean;
  case: ApiCase | null;
  group: { id: string; slug: string; name: string } | null;
  message: string | null;
  approval?: {
    id: string;
    level: "tool" | "field" | "completion";
    target: string;
    payload: unknown;
    reason: string | null;
  } | null;
  guardrail?: {
    id: string;
    agent: { id: string; slug: string } | null;
    change: ApiGuardrailChange;
    reason: string | null;
    requestedBy: { type: string; id: string };
  } | null;
};

type ApiInbox = { items: ApiInboxItem[]; unread: number };

const READ_BATCH = 500;

function caseLabel(item: ApiCase) {
  return item.title ?? "Untitled case";
}

function approvalSummary(
  approval: NonNullable<ApiInboxItem["approval"]>,
): string {
  switch (approval.level) {
    case "tool":
      return `Approve the ${approval.target} tool call`;
    case "field":
      return `Approve the value of ${approval.target}`;
    case "completion":
      return "Approve the finished case";
  }
}

function guardrailSummary(
  change: ApiGuardrailChange,
  agent: string | null,
): string {
  const scope = agent ?? "every agent";
  switch (change.kind) {
    case "network":
      return `Let ${scope} reach ${change.hosts.join(", ")}`;
    case "secret":
      return `Give ${scope} the ${change.secret} secret`;
    case "mcp":
      return `Give ${scope} the ${change.server} MCP server`;
    case "spending_limit":
      return change.limitUsd === null
        ? `Remove the spending limit for ${scope}`
        : `Raise the spending limit for ${scope} to $${change.limitUsd}`;
  }
}

function payloadText(payload: unknown): string | null {
  if (payload === null || payload === undefined) return null;
  return typeof payload === "string"
    ? payload
    : JSON.stringify(payload, null, 2);
}

function toItem(item: ApiInboxItem): InboxItem {
  const base = { id: item.key, createdAt: item.at, unread: !item.read };
  const subject = item.case;
  const caseLink = subject
    ? {
        kind: "case" as const,
        agentId: subject.agent.id,
        caseId: subject.id,
      }
    : undefined;
  const title = subject ? caseLabel(subject) : "Guardrail request";

  if (item.kind === "approval" && item.approval) {
    const { approval } = item;
    const payload = payloadText(approval.payload);
    const details: InboxDetail[] = [
      { label: "Approves", value: item.group?.name ?? "Any operator" },
      ...(approval.level === "completion"
        ? []
        : [
            {
              label: approval.level === "tool" ? "Tool" : "Field",
              value: approval.target,
            },
          ]),
      ...(payload ? [{ label: "Request", value: payload }] : []),
    ];
    return {
      ...base,
      kind: "approval",
      title,
      summary: approvalSummary(approval),
      body:
        approval.reason ??
        "The agent asked for a person to approve this before it continues.",
      link: caseLink,
      details,
    };
  }

  if (item.kind === "guardrail" && item.guardrail) {
    const { guardrail } = item;
    const agent = guardrail.agent?.slug ?? null;
    return {
      ...base,
      kind: "guardrail",
      title,
      summary: guardrailSummary(guardrail.change, agent),
      body: guardrail.reason ?? "No reason was given.",
      link: { kind: "guardrail", requestId: guardrail.id, agentSlug: agent },
      details: [{ label: "Agent", value: agent ?? "Every agent" }],
    };
  }

  switch (item.kind) {
    case "memory":
      return {
        ...base,
        kind: "memory",
        title,
        summary: "The agent proposed a rule for its memory",
        body: item.message ?? "",
        link: caseLink && { ...caseLink, view: "review" },
      };
    case "mention":
      return {
        ...base,
        kind: "mention",
        title: `${item.group?.name ?? "Your group"} was mentioned`,
        summary: subject ? `On ${caseLabel(subject)}` : "",
        body: item.message ?? "",
        link: caseLink,
      };
    case "assigned":
      return {
        ...base,
        kind: "assignment",
        title: "You were assigned",
        summary: subject ? caseLabel(subject) : "",
        body: "Open the case to pick up where the agent left off.",
        link: caseLink,
      };
    default:
      return {
        ...base,
        kind: "case-update",
        title,
        summary: `Waiting on ${item.group?.name ?? "your group"}`,
        body: "The case is waiting on your group before it can continue.",
        link: caseLink,
      };
  }
}

export const loadApiInbox = createServerFn({ method: "GET" }).handler(
  async (): Promise<InboxLoad> => {
    const asOf = new Date().toISOString();
    try {
      const { activeOrgJson } = await import("../../server/api.server");
      const inbox = await activeOrgJson<ApiInbox>("/inbox");
      const items = inbox.items.map(toItem);
      return {
        items,
        unreadCount: unreadCount(items),
        nextCursor: null,
        asOf,
        loadError: false,
      };
    } catch {
      return {
        items: [],
        unreadCount: 0,
        nextCursor: null,
        asOf,
        loadError: true,
      };
    }
  },
);

export const markApiInboxRead = createServerFn({ method: "POST" })
  .validator((selector: MarkReadSelector) => selector)
  .handler(async ({ data: selector }): Promise<InboxCounts> => {
    const { activeOrgJson, activeOrgPath, apiRequest } =
      await import("../../server/api.server");
    const inbox = await activeOrgJson<ApiInbox>("/inbox");
    const asOf = selector.kind === "all" ? Date.parse(selector.asOf) : 0;
    const keys = inbox.items
      .filter(
        (item) =>
          !item.read &&
          (selector.kind === "items"
            ? selector.ids.includes(item.key)
            : Date.parse(item.at) <= asOf),
      )
      .map((item) => item.key);
    const path = await activeOrgPath("/inbox/read");
    for (let start = 0; start < keys.length; start += READ_BATCH) {
      const response = await apiRequest(path, {
        method: "POST",
        body: JSON.stringify({ keys: keys.slice(start, start + READ_BATCH) }),
      });
      if (!response.ok) throw new Error(`POST /inbox/read: ${response.status}`);
    }
    return { unreadCount: inbox.unread - keys.length, changed: keys.length };
  });
