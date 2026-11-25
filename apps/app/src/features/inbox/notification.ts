export const INBOX_KINDS = [
  "mention",
  "assignment",
  "case-update",
  "agent",
  "overdue",
  "approval",
  "guardrail",
] as const;

export type InboxKind = (typeof INBOX_KINDS)[number];

export type NotificationLink =
  | { readonly kind: "case"; readonly agentId: string; readonly caseId: string }
  | { readonly kind: "agent"; readonly agentId: string }
  /** Where a guardrail request is reviewed: the agent's settings, or the
   * organization's network rules when it covers every agent. */
  | { readonly kind: "guardrail"; readonly agentId: string | null };

/** One labelled fact the reader lists, such as what an approval covers. */
export type InboxDetail = { readonly label: string; readonly value: string };

export type InboxItem = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly kind: InboxKind;
  readonly createdAt: string;
  readonly unread: boolean;
  readonly link?: NotificationLink;
  readonly details?: readonly InboxDetail[];
};

export type InboxPage = {
  readonly items: readonly InboxItem[];
  readonly unreadCount: number;
  readonly nextCursor: string | null;
  readonly asOf: string;
};

export type MarkReadSelector =
  | { readonly kind: "items"; readonly ids: readonly [string, ...string[]] }
  | { readonly kind: "all"; readonly asOf: string };

export type InboxCounts = {
  readonly unreadCount: number;
  readonly changed: number;
};

export class InboxContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new InboxContractError(`${field} must be a string.`);
  }
  return value;
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new InboxContractError(`${field} must be a non-negative integer.`);
  }
  return value;
}

function decodeInboxKind(value: unknown): InboxKind {
  if (typeof value !== "string" || !INBOX_KINDS.includes(value as InboxKind)) {
    throw new InboxContractError("InboxItem.kind is invalid.");
  }
  return value as InboxKind;
}

function decodeNotificationLink(value: unknown): NotificationLink {
  if (!isRecord(value)) {
    throw new InboxContractError("InboxItem.link must be an object.");
  }
  switch (value.kind) {
    case "case":
      return {
        kind: "case",
        agentId: readString(value.agentId, "InboxItem.link.agentId"),
        caseId: readString(value.caseId, "InboxItem.link.caseId"),
      };
    case "agent":
      return {
        kind: "agent",
        agentId: readString(value.agentId, "InboxItem.link.agentId"),
      };
    case "guardrail":
      return {
        kind: "guardrail",
        agentId:
          value.agentId === null
            ? null
            : readString(value.agentId, "InboxItem.link.agentId"),
      };
    default:
      throw new InboxContractError("InboxItem.link.kind is invalid.");
  }
}

export function decodeInboxItem(value: unknown): InboxItem {
  if (!isRecord(value) || typeof value.unread !== "boolean") {
    throw new InboxContractError("InboxItem is invalid.");
  }
  return {
    id: readString(value.id, "InboxItem.id"),
    title: readString(value.title, "InboxItem.title"),
    summary: readString(value.summary, "InboxItem.summary"),
    body: readString(value.body, "InboxItem.body"),
    kind: decodeInboxKind(value.kind),
    createdAt: readString(value.createdAt, "InboxItem.createdAt"),
    unread: value.unread,
    ...(value.link === undefined
      ? {}
      : { link: decodeNotificationLink(value.link) }),
  };
}

export function decodeInboxPage(value: unknown): InboxPage {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new InboxContractError("InboxPage is invalid.");
  }
  if (value.nextCursor !== null && typeof value.nextCursor !== "string") {
    throw new InboxContractError("InboxPage.nextCursor is invalid.");
  }
  return {
    items: value.items.map(decodeInboxItem),
    unreadCount: readCount(value.unreadCount, "InboxPage.unreadCount"),
    nextCursor: value.nextCursor,
    asOf: readString(value.asOf, "InboxPage.asOf"),
  };
}

export function decodeInboxCounts(value: unknown): InboxCounts {
  if (!isRecord(value)) {
    throw new InboxContractError("InboxCounts is invalid.");
  }
  return {
    unreadCount: readCount(value.unreadCount, "InboxCounts.unreadCount"),
    changed: readCount(value.changed, "InboxCounts.changed"),
  };
}

export type InboxSearch = {
  readonly item?: string;
};

export function parseInboxItemId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseInboxSearch(search: Record<string, unknown>): InboxSearch {
  return { item: parseInboxItemId(search.item) };
}

export function unreadCount(items: readonly InboxItem[]): number {
  return items.filter((item) => item.unread).length;
}

export function findInboxItem(
  items: readonly InboxItem[],
  id: string | undefined,
): InboxItem | undefined {
  if (!id) {
    return undefined;
  }
  return items.find((item) => item.id === id);
}

export function formatInboxTime(iso: string, nowMs = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) {
    return "";
  }
  const deltaMs = Math.max(0, nowMs - then);
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(then);
}

export function inboxKindLabel(kind: InboxKind): string {
  switch (kind) {
    case "mention":
      return "Mention";
    case "assignment":
      return "Assigned";
    case "case-update":
      return "Case update";
    case "agent":
      return "Agent";
    case "overdue":
      return "Overdue";
    case "approval":
      return "Approval";
    case "guardrail":
      return "Guardrail request";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
