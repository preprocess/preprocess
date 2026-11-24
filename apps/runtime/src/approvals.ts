// Approvals the agent's code requires (spec §9): before a tool call runs,
// on output values, and on case completion. Each names the group whose
// members approve, or null for any operator. The case's Durable Object keeps
// them beside its answers; the API mirrors them for the inbox.

import type { Effect } from "@preprocess/sdk/protocol";

export type ApprovalLevel = "completion" | "field" | "tool";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "stale";

export type Approval = {
  id: string;
  level: ApprovalLevel;
  // The field path or tool name; empty for completion.
  target: string;
  group: string | null;
  // What is approved: the tool call's input, the field's value, or the run.
  payload: unknown;
  reason: string | null;
  status: ApprovalStatus;
  run: number;
  requestedAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  note: string | null;
};

// The effect the SDK returns instead of running a tool that needs approval.
export type ApprovalEffect = Extract<Effect, { type: "approval" }>;

export const APPROVAL_TABLES = `
CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, level TEXT NOT NULL, target TEXT NOT NULL, grp TEXT, payload TEXT, reason TEXT, status TEXT NOT NULL, run INTEGER NOT NULL, requested_at INTEGER NOT NULL, decided_by TEXT, decided_at INTEGER, note TEXT);`;

type Row = {
  id: string;
  level: ApprovalLevel;
  target: string;
  grp: string | null;
  payload: string | null;
  reason: string | null;
  status: ApprovalStatus;
  run: number;
  requested_at: number;
  decided_by: string | null;
  decided_at: number | null;
  note: string | null;
};

const toApproval = (row: Row): Approval => ({
  id: row.id,
  level: row.level,
  target: row.target,
  group: row.grp,
  payload: row.payload === null ? null : JSON.parse(row.payload),
  reason: row.reason,
  status: row.status,
  run: row.run,
  requestedAt: row.requested_at,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  note: row.note,
});

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export class Approvals {
  constructor(private readonly sql: SqlStorage) {}

  list(): Approval[] {
    return this.sql
      .exec<Row>("SELECT * FROM approvals ORDER BY requested_at, id")
      .toArray()
      .map(toApproval);
  }

  pending(): Approval[] {
    return this.list().filter((a) => a.status === "pending");
  }

  get(id: string): Approval | null {
    const row = this.sql
      .exec<Row>("SELECT * FROM approvals WHERE id = ?", id)
      .toArray()[0];
    return row ? toApproval(row) : null;
  }

  request(input: {
    level: ApprovalLevel;
    target: string;
    group: string | null;
    payload: unknown;
    reason: string | null;
    run: number;
  }): Approval {
    const id = `apr_${crypto.randomUUID().replaceAll("-", "")}`;
    this.sql.exec(
      "INSERT INTO approvals (id, level, target, grp, payload, reason, status, run, requested_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
      id,
      input.level,
      input.target,
      input.group,
      JSON.stringify(input.payload ?? null),
      input.reason,
      input.run,
      Date.now(),
    );
    return this.get(id)!;
  }

  decide(
    id: string,
    status: "approved" | "rejected" | "stale",
    by: string | null,
    note: string | null,
  ): Approval {
    this.sql.exec(
      "UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ?",
      status,
      by,
      Date.now(),
      note,
      id,
    );
    return this.get(id)!;
  }

  // An output or completion approval for what the case holds now. One that
  // was approved for the same value stands; one rejected for it in this run
  // stays rejected until the next run; anything else asks again, and a
  // pending request for an older value goes stale.
  ensure(input: {
    level: "completion" | "field";
    target: string;
    group: string | null;
    payload: unknown;
    run: number;
  }): { approval: Approval; created: boolean; stale: Approval[] } {
    const mine = this.list().filter(
      (a) => a.level === input.level && a.target === input.target,
    );
    const current = mine.filter((a) => same(a.payload, input.payload));
    const latest = [...current].reverse();
    const kept =
      latest.find((a) => a.status === "approved" || a.status === "pending") ??
      latest.find((a) => a.status === "rejected" && a.run === input.run);
    const stale = mine
      .filter((a) => a.status === "pending" && a !== kept)
      .map((a) => this.decide(a.id, "stale", null, null));
    if (kept) return { approval: kept, created: false, stale };
    return {
      approval: this.request({ ...input, reason: null }),
      created: true,
      stale,
    };
  }

  // Requests for fields that no longer need one (hidden, or the rule no
  // longer applies) go stale.
  retire(keep: Set<string>): Approval[] {
    return this.pending()
      .filter((a) => a.level !== "tool" && !keep.has(`${a.level}:${a.target}`))
      .map((a) => this.decide(a.id, "stale", null, null));
  }
}
