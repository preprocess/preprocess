import { currentScenario } from "../../scenarios/current-scenario";
import type { ScenarioState } from "../../scenarios/scenarios";
import { OPTION_PAGE_SIZE, type CaseFile, type OptionPage } from "./case-api";
import type {
  ApprovalDecision,
  CaseRoomState,
  RoomAnswer,
  RoomApproval,
  RoomMemory,
  RoomField,
  RoomMessage,
  RoomOption,
  WriteResult,
} from "./case-room-state";

export type CaseWorkScenario = ScenarioState<"case-work">;

const T0 = Date.parse("2026-11-24T09:12:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

const VENDORS = [
  { id: "acme", label: "Acme Corporation" },
  { id: "globex", label: "Globex Ltd" },
  { id: "globex-eu", label: "Globex Europe GmbH" },
  { id: "initech", label: "Initech" },
];
const CURRENCIES = [
  { id: "EUR", label: "EUR" },
  { id: "USD", label: "USD" },
  { id: "GBP", label: "GBP" },
];
const GL_ACCOUNTS = [
  { id: "6100", label: "6100 · Office supplies" },
  { id: "6200", label: "6200 · Software" },
  { id: "6400", label: "6400 · Professional services" },
];

/**
 * The full lists behind the narrowed options the seeded rooms show, so the
 * Review tab's option search finds more than the room lists.
 */
const FULL_OPTIONS: Readonly<Record<string, readonly RoomOption[]>> = {
  vendor: [
    ...VENDORS,
    { id: "hooli", label: "Hooli Inc." },
    { id: "initrode", label: "Initrode Systems" },
    { id: "massive-dynamic", label: "Massive Dynamic" },
    { id: "soylent", label: "Soylent Corp" },
    { id: "stark", label: "Stark Industries" },
    { id: "umbrella", label: "Umbrella Corporation" },
    { id: "wayne", label: "Wayne Enterprises" },
    { id: "weyland", label: "Weyland-Yutani" },
  ],
  glAccount: [
    ...GL_ACCOUNTS,
    { id: "6300", label: "6300 · Travel" },
    { id: "6500", label: "6500 · Rent" },
    { id: "6600", label: "6600 · Marketing" },
    { id: "6700", label: "6700 · Training" },
    { id: "6800", label: "6800 · Insurance" },
  ],
};

const answer = (
  path: string,
  value: unknown,
  extra: Partial<RoomAnswer> = {},
): RoomAnswer => ({
  path,
  value,
  status: "agent",
  setBy: "agent",
  setAt: T0 + 60_000,
  staleBecause: null,
  suggestedAt: null,
  version: 1,
  ...extra,
});

const field = (
  path: string,
  kind: RoomField["kind"],
  value: unknown,
  extra: Partial<RoomField> = {},
  answerExtra: Partial<RoomAnswer> = {},
): RoomField => ({
  path,
  kind,
  visible: true,
  hiddenBecause: null,
  review: "none",
  options: null,
  error: null,
  answer: value === undefined ? null : answer(path, value, answerExtra),
  ...extra,
});

const INPUT: RoomMessage = {
  id: "msg_input",
  at: at(0),
  by: "input",
  kind: "input",
  text: "Invoice 1042 from Globex, attached.",
  group: null,
};

const event = (id: string, minutes: number, text: string): RoomMessage => ({
  id,
  at: at(minutes),
  by: "platform",
  kind: "event",
  text,
  group: null,
});

const baseFields = (overrides: Record<string, RoomField> = {}) => {
  const fields: RoomField[] = [
    field("vendor", "select", "globex", { options: VENDORS }),
    field("invoiceNumber", "text", "INV-1042"),
    field("amount", "number", 1285),
    field("currency", "select", "EUR", { options: CURRENCIES }),
    field("dueDate", "date", "2026-12-24"),
    field("glAccount", "select", "6400", { options: GL_ACCOUNTS }),
    field("paymentTerms", "text", "Net 30", {
      review: "required",
      description: "Terms as printed; a person confirms them.",
    }),
    field("vatNumber", "text", undefined, {
      visible: false,
      hiddenBecause: [{ path: "currency", value: "EUR" }],
      description: "Only for invoices outside the EU.",
    }),
  ];
  return fields.map((f) => overrides[f.path] ?? f);
};

const approval = (
  id: string,
  level: RoomApproval["level"],
  target: string,
  extra: Partial<RoomApproval> = {},
): RoomApproval => ({
  id,
  level,
  target,
  group: null,
  payload: null,
  reason: null,
  status: "pending",
  run: 1,
  requestedAt: T0 + 4 * 60_000,
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  note: null,
  ...extra,
});

const PAYMENT = {
  vendor: "globex",
  amount: 1285,
  currency: "EUR",
  dueDate: "2026-12-24",
};

const answersOf = (fields: readonly RoomField[]) =>
  Object.fromEntries(
    fields
      .filter((f) => f.visible && f.answer && f.answer.value !== null)
      .map((f) => [f.path, f.answer!.value]),
  );

type SeededWork = Omit<CaseRoomState, "approvals" | "memories"> & {
  readonly approvals?: readonly RoomApproval[];
  readonly memories?: readonly RoomMemory[];
};

function seededRoom(scenario: CaseWorkScenario): CaseRoomState {
  const work = seededWork(scenario);
  return {
    ...work,
    approvals: work.approvals ?? [],
    memories: work.memories ?? [],
  };
}

const memory = (
  id: string,
  text: string,
  reason: string,
  minutes: number,
): RoomMemory => ({
  id,
  text,
  reason,
  status: "proposed",
  proposedAt: new Date(T0 + minutes * 60_000).toISOString(),
  decidedAt: null,
  decidedByName: null,
});

function seededWork(scenario: CaseWorkScenario): SeededWork {
  switch (scenario) {
    case "waiting": {
      const fields = baseFields({
        vendor: field("vendor", "select", null, {
          options: VENDORS,
          error: 'No vendor in the ERP matches "Globex Ltd."',
        }),
        glAccount: field("glAccount", "select", undefined, {
          options: GL_ACCOUNTS,
        }),
      });
      return {
        status: "waiting",
        run: 1,
        waitingOn: {
          group: "accounts-payable",
          reason: "Vendor not found in ERP",
        },
        reason: null,
        fields,
        checks: [
          {
            name: "vendor-known",
            ok: false,
            field: "vendor",
            message: "Pick the vendor this invoice is from.",
          },
          { name: "total-matches-lines", ok: true },
        ],
        answers: null,
        thread: [
          INPUT,
          event("ev_1", 0, "Run 1 started"),
          {
            id: "msg_tag",
            at: at(3),
            by: "agent",
            kind: "tag",
            text: "@accounts-payable I couldn't match Globex Ltd to a vendor in the ERP. Which vendor is it?",
            group: "accounts-payable",
          },
          event("ev_2", 3, "Waiting on Accounts payable"),
        ],
      };
    }
    case "review": {
      const fields = baseFields({
        vendor: field(
          "vendor",
          "select",
          "globex",
          { options: VENDORS },
          {
            status: "confirmed",
            setBy: "person:usr_ana",
            version: 3,
            suggestedValue: "globex-eu",
            suggestedAt: T0 + 9 * 60_000,
          },
        ),
        amount: field(
          "amount",
          "number",
          1285,
          {},
          {
            status: "stale",
            staleBecause: [{ path: "currency", from: "USD", to: "EUR" }],
            version: 2,
          },
        ),
        currency: field(
          "currency",
          "select",
          "EUR",
          { options: CURRENCIES },
          {
            status: "confirmed",
            setBy: "person:usr_ana",
            version: 2,
          },
        ),
      });
      return {
        status: "completed",
        run: 2,
        waitingOn: null,
        reason: null,
        fields,
        checks: [
          {
            name: "total-matches-lines",
            ok: false,
            field: "amount",
            message: "The total is 1,285.00 but the lines add up to 1,258.00.",
          },
          { name: "vendor-known", ok: true },
        ],
        answers: answersOf(fields),
        thread: [
          INPUT,
          event("ev_1", 0, "Run 1 started"),
          event("ev_2", 3, "Waiting on Accounts payable"),
          {
            id: "msg_p1",
            at: at(6),
            by: "person:usr_ana",
            byName: "Ana",
            kind: "person",
            text: "It's Globex Ltd, and the invoice is in EUR.",
            group: null,
          },
          event("ev_3", 7, "Run 2 started"),
          {
            id: "msg_a2",
            at: at(9),
            by: "agent",
            kind: "agent",
            text: "Kept your vendor. The VAT number on the invoice belongs to Globex Europe GmbH, so I suggested that beside it.",
            group: null,
          },
          event("ev_4", 9, "Completed"),
        ],
      };
    }
    case "running":
      return {
        status: "running",
        run: 1,
        waitingOn: null,
        reason: null,
        fields: baseFields({
          glAccount: field("glAccount", "select", undefined, {
            options: GL_ACCOUNTS,
          }),
          paymentTerms: field("paymentTerms", "text", undefined, {
            review: "required",
          }),
          dueDate: field("dueDate", "date", undefined),
        }),
        checks: [],
        answers: null,
        thread: [INPUT, event("ev_1", 0, "Run 1 started")],
      };
    case "completed": {
      const fields = baseFields({
        paymentTerms: field(
          "paymentTerms",
          "text",
          "Net 30",
          { review: "required" },
          {
            status: "confirmed",
            version: 2,
          },
        ),
      });
      return {
        status: "completed",
        run: 1,
        waitingOn: null,
        reason: null,
        fields,
        checks: [
          { name: "total-matches-lines", ok: true },
          { name: "vendor-known", ok: true },
        ],
        answers: answersOf(fields),
        thread: [
          INPUT,
          event("ev_1", 0, "Run 1 started"),
          event("ev_2", 4, "Completed"),
        ],
      };
    }
    case "halted":
      return {
        status: "halted",
        run: 1,
        waitingOn: null,
        reason: "spending_limit_reached",
        fields: baseFields({
          glAccount: field("glAccount", "select", undefined, {
            options: GL_ACCOUNTS,
          }),
          paymentTerms: field("paymentTerms", "text", undefined, {
            review: "required",
          }),
        }),
        checks: [],
        answers: null,
        thread: [
          INPUT,
          event("ev_1", 0, "Run 1 started"),
          event(
            "ev_2",
            2,
            "Halted: the organization reached its monthly spending limit",
          ),
        ],
      };
    case "failed":
      return {
        status: "failed",
        run: 1,
        waitingOn: null,
        reason: "The ERP lookup timed out three times.",
        fields: baseFields({
          glAccount: field("glAccount", "select", undefined, {
            options: GL_ACCOUNTS,
          }),
        }),
        checks: [{ name: "total-matches-lines", ok: true }],
        answers: null,
        thread: [
          INPUT,
          event("ev_1", 0, "Run 1 started"),
          event("ev_2", 5, "Failed"),
        ],
      };
    case "approval-tool": {
      const fields = baseFields();
      return {
        status: "waiting",
        run: 1,
        waitingOn: null,
        reason: null,
        fields,
        checks: [
          { name: "total-matches-lines", ok: true },
          { name: "vendor-known", ok: true },
        ],
        answers: answersOf(fields),
        thread: [
          INPUT,
          event("ev_1", 0, "Run 1 started"),
          event(
            "ev_2",
            4,
            "Waiting for finance to approve the call to post_payment",
          ),
          event(
            "ev_3",
            4,
            "Waiting for legal to approve the call to email_vendor",
          ),
        ],
        approvals: [
          approval("apr_payment", "tool", "post_payment", {
            group: "finance",
            payload: PAYMENT,
            reason: "Payments over 1,000 EUR need Finance.",
          }),
          approval("apr_email", "tool", "email_vendor", {
            group: "legal",
            payload: {
              to: "billing@globex.example",
              subject: "Invoice INV-1042 scheduled",
            },
            reason: "Mail to vendors goes through Legal.",
          }),
        ],
      };
    }
    case "approval-completion": {
      const fields = baseFields();
      return {
        status: "waiting",
        run: 1,
        waitingOn: null,
        reason: null,
        fields,
        checks: [
          { name: "total-matches-lines", ok: true },
          { name: "vendor-known", ok: true },
        ],
        answers: answersOf(fields),
        thread: [
          INPUT,
          event("ev_1", 0, "Run 1 started"),
          event("ev_2", 4, "Waiting for an operator to approve glAccount"),
          event(
            "ev_3",
            4,
            "Waiting for accounts-payable to approve completing the case",
          ),
        ],
        approvals: [
          approval("apr_gl", "field", "glAccount", {
            payload: "6400",
            reason: "GL account changes need a person.",
          }),
          approval("apr_done", "completion", "", {
            group: "accounts-payable",
            payload: { run: 1 },
            reason: "Every invoice is approved before it's posted.",
          }),
        ],
      };
    }
    case "approval-decided": {
      const fields = baseFields();
      const decided = (minutes: number, name: string) => ({
        decidedBy: `person:usr_${name.toLowerCase()}`,
        decidedByName: name,
        decidedAt: T0 + minutes * 60_000,
      });
      return {
        status: "completed",
        run: 2,
        waitingOn: null,
        reason: null,
        fields,
        checks: [
          { name: "total-matches-lines", ok: true },
          { name: "vendor-known", ok: true },
        ],
        answers: answersOf(fields),
        thread: [
          INPUT,
          event("ev_1", 0, "Run 1 started"),
          event("ev_2", 6, "Rejected glAccount: Software, not services."),
          event("ev_3", 7, "Run 2 started"),
          event(
            "ev_4",
            9,
            "Approved the call to post_payment: Matches PO 7731.",
          ),
          event("ev_5", 10, "Approved completing the case"),
          event("ev_6", 10, "Completed"),
        ],
        approvals: [
          approval("apr_gl_1", "field", "glAccount", {
            payload: "6400",
            reason: "GL account changes need a person.",
            status: "rejected",
            note: "Software, not services. Use 6200.",
            ...decided(6, "Ana"),
          }),
          approval("apr_gl_2", "field", "glAccount", {
            payload: "6100",
            run: 2,
            reason: "GL account changes need a person.",
            status: "stale",
            decidedAt: T0 + 8 * 60_000,
          }),
          approval("apr_payment", "tool", "post_payment", {
            group: "finance",
            payload: PAYMENT,
            run: 2,
            reason: "Payments over 1,000 EUR need Finance.",
            status: "approved",
            note: "Matches PO 7731.",
            ...decided(9, "Sam"),
          }),
          approval("apr_done", "completion", "", {
            group: "accounts-payable",
            payload: { run: 2 },
            run: 2,
            status: "approved",
            ...decided(10, "Ana"),
          }),
        ],
        memories: [
          memory(
            "mem_gl_software",
            "Software subscriptions go to GL account 6200, not 6400.",
            "Ana rejected 6400 for a software invoice and asked for 6200.",
            6,
          ),
          memory(
            "mem_globex_finance",
            "Globex payments over 1,000 EUR need Finance to approve post_payment.",
            "Finance approved the Globex payment after checking PO 7731.",
            9,
          ),
        ],
      };
    }
    case "live":
    case "empty":
      return {
        status: "queued",
        run: 0,
        waitingOn: null,
        reason: null,
        fields: [],
        checks: [],
        answers: null,
        thread: [],
      };
    default: {
      const exhaustive: never = scenario;
      return exhaustive;
    }
  }
}

// Changes stick in memory until the scenario changes or the page reloads.
const rooms = new Map<string, CaseRoomState>();

const roomKey = (agentId: string, caseId: string) =>
  `${currentScenario()["case-work"]}:${agentId}/${caseId}`;

export function resetCaseRooms() {
  rooms.clear();
  caseFiles.clear();
  caseFileBodies.clear();
}

// Files attached in the room, kept like the rooms' changes.
const caseFiles = new Map<string, CaseFile[]>();
const caseFileBodies = new Map<string, File>();

/** An attached file's bytes, as the download route returns them. */
export function caseFileBody(
  agentId: string,
  caseId: string,
  file: CaseFile,
): Promise<File> {
  const body = caseFileBodies.get(`${roomKey(agentId, caseId)}:${file.id}`);
  return body
    ? Promise.resolve(body)
    : Promise.reject(new Error("No such file."));
}

export function getCaseFiles(agentId: string, caseId: string) {
  return Promise.resolve(caseFiles.get(roomKey(agentId, caseId)) ?? []);
}

/** Attaches files as the API does: refused on a cancelled case. */
export async function attachFiles(
  agentId: string,
  caseId: string,
  files: readonly File[],
): Promise<ApprovalDecision> {
  const room = await getCaseRoom(agentId, caseId);
  if (room.status === "cancelled")
    return {
      ok: false,
      code: "case_cancelled",
      message: "The case is cancelled.",
    };
  const key = roomKey(agentId, caseId);
  const now = new Date().toISOString();
  const attached = files.map((file) => {
    const id = `file_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    caseFileBodies.set(`${key}:${id}`, file);
    return {
      id,
      name: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      createdAt: now,
    };
  });
  caseFiles.set(key, [...(caseFiles.get(key) ?? []), ...attached]);
  return { ok: true };
}

export function getCaseRoom(
  agentId: string,
  caseId: string,
): Promise<CaseRoomState> {
  const key = roomKey(agentId, caseId);
  const room = rooms.get(key) ?? seededRoom(currentScenario()["case-work"]);
  rooms.set(key, room);
  return Promise.resolve(room);
}

const YOU = "person:usr_you";

async function update(
  agentId: string,
  caseId: string,
  change: (room: CaseRoomState) => CaseRoomState,
) {
  const room = await getCaseRoom(agentId, caseId);
  const next = change(room);
  rooms.set(roomKey(agentId, caseId), {
    ...next,
    answers: answersOf(next.fields),
  });
}

function write(
  agentId: string,
  caseId: string,
  path: string,
  version: number,
  apply: (field: RoomField) => RoomAnswer | null,
): Promise<WriteResult> {
  let result: WriteResult = { result: "refused", reason: "No such field." };
  return update(agentId, caseId, (room) => ({
    ...room,
    fields: room.fields.map((f) => {
      if (f.path !== path) return f;
      if ((f.answer?.version ?? 0) !== version) {
        result = { result: "conflict", version: f.answer?.version ?? 0 };
        return f;
      }
      const next = apply(f);
      result = { result: next ? "ok" : "unchanged", stale: [] };
      return next ? { ...f, error: null, answer: next } : f;
    }),
  })).then(() => result);
}

export function editAnswer(
  agentId: string,
  caseId: string,
  input: { path: string; value: unknown; version: number },
): Promise<WriteResult> {
  return write(agentId, caseId, input.path, input.version, (f) => ({
    path: f.path,
    value: input.value,
    status: "confirmed",
    setBy: YOU,
    setAt: Date.now(),
    staleBecause: null,
    suggestedAt: null,
    version: (f.answer?.version ?? 0) + 1,
  }));
}

export function confirmAnswer(
  agentId: string,
  caseId: string,
  input: { path: string; version: number },
): Promise<WriteResult> {
  return write(agentId, caseId, input.path, input.version, (f) =>
    f.answer
      ? {
          ...f.answer,
          status: "confirmed",
          staleBecause: null,
          version: f.answer.version + 1,
        }
      : null,
  );
}

export function acceptSuggestion(
  agentId: string,
  caseId: string,
  input: { path: string; version: number },
): Promise<WriteResult> {
  return write(agentId, caseId, input.path, input.version, (f) => {
    if (!f.answer || !("suggestedValue" in f.answer)) return null;
    const { suggestedValue, ...rest } = f.answer;
    return {
      ...rest,
      value: suggestedValue,
      status: "confirmed",
      setBy: YOU,
      setAt: Date.now(),
      suggestedAt: null,
      version: f.answer.version + 1,
    };
  });
}

export function rerunCase(agentId: string, caseId: string) {
  return update(agentId, caseId, (room) => ({
    ...room,
    status: "running",
    run: room.run + 1,
    waitingOn: null,
    reason: null,
    thread: [
      ...room.thread,
      {
        id: `ev_run_${room.run + 1}`,
        at: new Date().toISOString(),
        by: "platform",
        kind: "event",
        text: `Run ${room.run + 1} started`,
        group: null,
      },
    ],
  }));
}

/** Groups the seeded "you" is in; any other group's approvals refuse you. */
const YOUR_GROUPS = ["finance", "accounts-payable"];

export async function decideApproval(
  agentId: string,
  caseId: string,
  input: { approvalId: string; decision: "approve" | "reject"; text: string },
): Promise<ApprovalDecision> {
  const room = await getCaseRoom(agentId, caseId);
  const found = room.approvals.find((a) => a.id === input.approvalId);
  if (!found)
    return { ok: false, code: "not_found", message: "No such approval." };
  if (found.status !== "pending")
    return {
      ok: false,
      code: "approval_decided",
      message: `The approval is ${found.status}.`,
    };
  if (room.status === "running")
    return {
      ok: false,
      code: "case_running",
      message: "Decide once the run ends.",
    };
  if (found.group && !YOUR_GROUPS.includes(found.group))
    return {
      ok: false,
      code: "forbidden",
      message: `Only members of ${found.group} approve this.`,
    };
  const approve = input.decision === "approve";
  const note = input.text.trim() || null;
  await update(agentId, caseId, (current) => ({
    ...current,
    approvals: current.approvals.map((a) =>
      a.id === found.id
        ? {
            ...a,
            status: approve ? "approved" : "rejected",
            decidedBy: YOU,
            decidedByName: "You",
            decidedAt: Date.now(),
            note,
          }
        : a,
    ),
    thread: [
      ...current.thread,
      {
        id: `ev_${found.id}`,
        at: new Date().toISOString(),
        by: YOU,
        kind: "event",
        text: `${approve ? "Approved" : "Rejected"} ${found.target || "completing the case"}${note ? `: ${note}` : ""}`,
        group: found.group,
      },
    ],
  }));
  return { ok: true };
}

export async function decideMemory(
  agentId: string,
  caseId: string,
  input: { memoryId: string; decision: "accept" | "dismiss" },
): Promise<ApprovalDecision> {
  const room = await getCaseRoom(agentId, caseId);
  const found = room.memories.find((m) => m.id === input.memoryId);
  if (!found)
    return { ok: false, code: "not_found", message: "No such proposal." };
  if (found.status !== "proposed")
    return {
      ok: false,
      code: "memory_decided",
      message: `The rule is ${found.status}.`,
    };
  await update(agentId, caseId, (current) => ({
    ...current,
    memories: current.memories.map((m) =>
      m.id === found.id
        ? {
            ...m,
            status: input.decision === "accept" ? "accepted" : "dismissed",
            decidedAt: new Date().toISOString(),
            decidedByName: "You",
          }
        : m,
    ),
  }));
  return { ok: true };
}

export async function postMessage(
  agentId: string,
  caseId: string,
  text: string,
): Promise<ApprovalDecision> {
  await update(agentId, caseId, (room) => ({
    ...room,
    thread: [
      ...room.thread,
      {
        id: `msg_${Date.now()}`,
        at: new Date().toISOString(),
        by: YOU,
        byName: "You",
        kind: "person",
        text,
        group: null,
      },
    ],
  }));
  return { ok: true };
}

export function cancelCase(agentId: string, caseId: string) {
  return update(agentId, caseId, (room) => ({
    ...room,
    status: "cancelled",
    waitingOn: null,
    thread: [
      ...room.thread,
      {
        id: "ev_cancelled",
        at: new Date().toISOString(),
        by: "platform",
        kind: "event",
        text: "Cancelled",
        group: null,
      },
    ],
  }));
}

/**
 * Completes a waiting case as the API does: refused unless it is waiting and
 * its checks pass, and still waiting while an approval is pending.
 */
export async function completeCase(
  agentId: string,
  caseId: string,
): Promise<ApprovalDecision> {
  const room = await getCaseRoom(agentId, caseId);
  if (room.status !== "waiting")
    return {
      ok: false,
      code: "case_not_completable",
      message: `The case is ${room.status}.`,
    };
  const failing = room.checks.filter((c) => !c.ok).map((c) => c.name);
  if (failing.length > 0)
    return {
      ok: false,
      code: "case_not_done",
      message: `Checks failing: ${failing.join(", ")}`,
    };
  if (room.approvals.some((a) => a.status === "pending")) return { ok: true };
  await update(agentId, caseId, (current) => ({
    ...current,
    status: "completed",
    waitingOn: null,
    thread: [
      ...current.thread,
      {
        id: "ev_completed",
        at: new Date().toISOString(),
        by: "platform",
        kind: "event",
        text: "Completed",
        group: null,
      },
    ],
  }));
  return { ok: true };
}

/** Searches a seeded field's full option list, as the API's search does. */
export async function searchOptions(
  agentId: string,
  caseId: string,
  input: { path: string; query: string },
): Promise<OptionPage> {
  const room = await getCaseRoom(agentId, caseId);
  const all =
    FULL_OPTIONS[input.path] ??
    room.fields.find((f) => f.path === input.path)?.options ??
    [];
  const query = input.query.trim().toLowerCase();
  const matches = query
    ? all.filter((option) =>
        [option.id, option.label, option.description ?? ""].some((text) =>
          text.toLowerCase().includes(query),
        ),
      )
    : all;
  return {
    items: matches.slice(0, OPTION_PAGE_SIZE),
    total: matches.length,
    more: matches.length > OPTION_PAGE_SIZE,
  };
}
