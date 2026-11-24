/**
 * The case room's work, in the shape of `GET /v1/orgs/{org}/cases/{id}/room`
 * (apps/api, design doc 05): the output schema's fields with their answers,
 * the checks, and the thread. Until the app talks to the API, development
 * serves seeded states shaped the same (`case-room-seed.ts`).
 */

export type RoomStatus =
  | "queued"
  | "running"
  | "waiting"
  | "halted"
  | "completed"
  | "failed"
  | "cancelled";

export type StaleReason = {
  readonly path: string;
  readonly from: unknown;
  readonly to: unknown;
};

export type RoomAnswer = {
  readonly path: string;
  readonly value: unknown;
  /** agent: the agent's; confirmed: a person's, or one a person confirmed. */
  readonly status: "agent" | "confirmed" | "stale";
  /** "agent" or "person:<userId>". */
  readonly setBy: string;
  readonly setAt: number;
  readonly staleBecause: readonly StaleReason[] | null;
  /** The agent's differing value beside a person's answer. */
  readonly suggestedValue?: unknown;
  readonly suggestedAt: number | null;
  readonly version: number;
};

export type RoomOption = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

export type RoomField = {
  readonly path: string;
  readonly kind:
    | "text"
    | "number"
    | "boolean"
    | "date"
    | "select"
    | "multiselect"
    | "group"
    | "list"
    | "fetched";
  readonly description?: string;
  readonly visible: boolean;
  readonly hiddenBecause: readonly { path: string; value: unknown }[] | null;
  readonly review: "required" | "none";
  readonly options: readonly RoomOption[] | null;
  readonly error: string | null;
  readonly answer: RoomAnswer | null;
};

export type RoomCheck = {
  readonly name: string;
  readonly ok: boolean;
  readonly field?: string;
  readonly message?: string;
};

export type RoomMessage = {
  readonly id: string;
  readonly at: string;
  /** "agent", "platform", "person:<userId>" or "input". */
  readonly by: string;
  readonly kind: "input" | "agent" | "person" | "tag" | "event";
  readonly text: string;
  readonly group: string | null;
};

export type CaseRoomState = {
  readonly status: RoomStatus;
  readonly run: number;
  readonly waitingOn: {
    readonly group: string;
    readonly reason: string | null;
  } | null;
  /** Why the case failed, or the halt reason (spending_limit_reached). */
  readonly reason: string | null;
  readonly fields: readonly RoomField[];
  readonly checks: readonly RoomCheck[];
  readonly answers: Record<string, unknown> | null;
  readonly thread: readonly RoomMessage[];
};

/** What a change to an answer returned (PATCH /answers and friends). */
export type WriteResult =
  | {
      readonly result: "ok" | "suggested" | "unchanged";
      readonly stale: readonly string[];
    }
  | { readonly result: "refused"; readonly reason: string }
  | { readonly result: "conflict"; readonly version: number };

/** "lines[2].glAccount" → "Gl account", the last segment, read as words. */
export function fieldLabel(path: string): string {
  const last = path.split(".").at(-1) ?? path;
  const words = last
    .replace(/\[\d+\]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** How a value reads in the room; options show their label. */
export function formatValue(field: RoomField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const label = (id: unknown) =>
    field.options?.find((o) => o.id === id)?.label ?? String(id);
  if (Array.isArray(value)) return value.map(label).join(", ");
  if (field.kind === "select") return label(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  return JSON.stringify(value);
}

/** Whether people can still change the case's answers. */
export function isEditable(status: RoomStatus): boolean {
  return (
    status === "waiting" ||
    status === "completed" ||
    status === "failed" ||
    status === "halted"
  );
}

export const HALT_REASONS: Record<string, string> = {
  spending_limit_reached:
    "This organization reached the monthly spending limit an Admin set.",
  credit_exhausted: "This organization ran out of credit.",
};
