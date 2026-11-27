// Datasets (design doc 10): a saved query over one agent's closed cases, its
// conditions on the cases table, and the three export formats built from
// run capture and review events. A person's edits are review events of kind
// field.edited; a case with one is corrected.

import { cases, reviewEvents } from "@preprocess/db/schema/cases";
import type {
  DatasetPeriod,
  DatasetQuery,
} from "@preprocess/db/schema/datasets";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { ExportFilter, ExportItem, ReviewEvent } from "./capture.ts";
import type { RunCapture } from "./env.ts";

export const EDIT = "field.edited";
// Kinds whose `after` is the field's value once a person acted.
const CORRECTIONS = new Set([EDIT, "suggestion.accepted"]);

export const edited = (paths?: string[]) =>
  sql`exists (select 1 from ${reviewEvents} where ${reviewEvents.caseId} = ${cases.id} and ${reviewEvents.kind} = ${EDIT}${
    paths ? sql` and ${inArray(reviewEvents.path, paths)}` : sql``
  })`;

const DAY = 86_400_000;
const PERIOD_DAYS: Record<DatasetPeriod, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

// A new dataset's query when none is given: the last 30 days, completed,
// every deployment, edited or not, either outcome.
export const DEFAULT_QUERY: DatasetQuery = {
  period: "30d",
  status: ["completed"],
};

// The query's conditions as of `now`; only closed cases are ever included
// (closedCases).
export const datasetFilter = (
  query: DatasetQuery,
  now = new Date(),
): ExportFilter => {
  const days = query.period ? PERIOD_DAYS[query.period] : null;
  const where: (SQL | undefined)[] = [];
  if (query.deployments?.length)
    where.push(inArray(cases.deploymentId, query.deployments));
  if (query.edited && "any" in query.edited) where.push(edited());
  if (query.edited && "fields" in query.edited)
    where.push(edited(query.edited.fields));
  if (query.edited && "none" in query.edited) where.push(sql`not ${edited()}`);
  if (query.outcome === "corrected") where.push(edited());
  if (query.outcome === "accepted")
    where.push(and(eq(cases.status, "completed"), sql`not ${edited()}`));
  return {
    from:
      days === null
        ? query.from
        : new Date(now.getTime() - days * DAY).toISOString(),
    to: query.to,
    status: query.status,
    where,
  };
};

export const editedFields = (events: ReviewEvent[]) => [
  ...new Set(
    events.flatMap((e) => (e.kind === EDIT && e.path ? [e.path] : [])),
  ),
];

type Message = { role: string; content?: unknown; [key: string]: unknown };
type ToolCall = {
  type: "toolCall";
  name: string;
  arguments: { answers?: { path: string; value: unknown }[] };
};
type WriteResult = { path?: string; result?: string; after?: unknown };

const SCHEMA_ANSWER = "schema_answer";

const answerCalls = (message: Message): ToolCall[] =>
  message.role === "assistant" && Array.isArray(message.content)
    ? (message.content as ToolCall[]).filter(
        (block) => block?.type === "toolCall" && block.name === SCHEMA_ANSWER,
      )
    : [];

// The model conversation of the last turn (model.request's context and the
// response to it), which holds every earlier turn the model saw.
const conversation = (capture: RunCapture): Message[] | null => {
  const events = [...capture.events].reverse();
  const request = events.find((e) => e.kind === "model.request");
  if (!request) return null;
  const context = request.data.context as { messages?: Message[] } | undefined;
  const messages = [...(context?.messages ?? [])];
  const response = events.find(
    (e) => e.kind === "model.response" && e.data.turn === request.data.turn,
  );
  if (response) messages.push(response.data.message as Message);
  return messages.length ? messages : null;
};

// Each field a person corrected, with the value they left it at.
const corrections = (events: ReviewEvent[]) => {
  const values = new Map<string, unknown>();
  for (const e of events)
    if (CORRECTIONS.has(e.kind) && e.path) values.set(e.path, e.after);
  return values;
};

// The conversation with the agent's answers replaced by the corrected ones:
// every schema_answer call and its result carry the person's value, and a
// field only the person answered joins the last schema_answer call.
const corrected = (messages: Message[], values: Map<string, unknown>) => {
  const out = structuredClone(messages);
  const unanswered = new Map(values);
  let last: ToolCall | undefined;
  for (const message of out) {
    for (const call of answerCalls(message)) {
      last = call;
      for (const answer of call.arguments.answers ?? [])
        if (values.has(answer.path)) {
          answer.value = values.get(answer.path);
          unanswered.delete(answer.path);
        }
    }
    if (message.role !== "toolResult" || message.toolName !== SCHEMA_ANSWER)
      continue;
    for (const block of (message.content ?? []) as {
      type?: string;
      text?: string;
    }[]) {
      if (block.type !== "text" || !block.text) continue;
      try {
        const results = JSON.parse(block.text) as WriteResult[];
        if (!Array.isArray(results)) continue;
        for (const r of results)
          if (r.path !== undefined && values.has(r.path) && "after" in r)
            r.after = values.get(r.path);
        block.text = JSON.stringify(results);
      } catch {
        // not a write result
      }
    }
  }
  if (last && unanswered.size)
    last.arguments.answers = [
      ...(last.arguments.answers ?? []),
      ...[...unanswered].map(([path, value]) => ({ path, value })),
    ];
  return out;
};

export const FORMATS = {
  // { case, messages }: the conversation, corrected.
  sft: (item: ExportItem) => {
    const messages = item.capture && conversation(item.capture);
    if (!messages) return null;
    return {
      case: item.case,
      messages: corrected(messages, corrections(item.reviewEvents)),
    };
  },
  // { case, prompt, chosen, rejected }: the conversation up to the agent's
  // first answer, then the corrected and the agent's own continuation.
  preference: (item: ExportItem) => {
    if (!item.reviewEvents.some((e) => e.kind === EDIT)) return null;
    const messages = item.capture && conversation(item.capture);
    if (!messages) return null;
    const split = messages.findIndex((m) => answerCalls(m).length > 0);
    if (split < 0) return null;
    return {
      case: item.case,
      prompt: messages.slice(0, split),
      chosen: corrected(messages, corrections(item.reviewEvents)).slice(split),
      rejected: messages.slice(split),
    };
  },
  // The capture export's line, which an environment replays.
  replay: (item: ExportItem) => item,
} as const;

export type DatasetFormat = keyof typeof FORMATS;
