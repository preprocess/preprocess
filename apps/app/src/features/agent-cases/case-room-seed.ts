import { currentScenario } from "../../scenarios/current-scenario";
import type { ScenarioState } from "../../scenarios/scenarios";
import type {
  CaseRoomState,
  RoomAnswer,
  RoomField,
  RoomMessage,
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

const answersOf = (fields: readonly RoomField[]) =>
  Object.fromEntries(
    fields
      .filter((f) => f.visible && f.answer && f.answer.value !== null)
      .map((f) => [f.path, f.answer!.value]),
  );

function seededRoom(scenario: CaseWorkScenario): CaseRoomState {
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
