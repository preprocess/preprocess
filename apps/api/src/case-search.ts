// Case search (spec 10): an agent's search_cases tool over its own completed
// cases in the same organization and environment. Each completed case has one
// row in case_search with its input, final answers and the paths a person
// changed, searched with Postgres full text. An eval case sees only cases
// completed before the case it replays started, with their answers as they
// stood then, and never that case or another with the same input.

import { orgId, withOrg } from "@preprocess/db/client";
import type { DbEnv, Tx } from "@preprocess/db/client";
import {
  cases,
  caseSearch,
  files,
  reviewEvents,
} from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";

import type { StartCase } from "./env.ts";
import { withValue } from "./evals.ts";

export const SEARCH_LIMIT = 10;
const INPUT_CHARS = 4000;
const QUERY_TERMS = 16;

// Review kinds that change an answer's value; a confirmation keeps it.
const CORRECTIONS = ["field.edited", "suggestion.accepted"];

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// The case's input text and its files' contents, so the same document sent
// again under another case hashes the same.
const inputHash = async (tx: Tx, caseId: string, text: string) => {
  const rows = await tx
    .select({ sha256: files.sha256 })
    .from(files)
    .where(eq(files.caseId, caseId));
  const body = JSON.stringify({
    text: text.trim(),
    files: rows.map((r) => hex(r.sha256)).sort(),
  });
  return hex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
  );
};

const inputText = (input: StartCase["input"]) => {
  const names = (input.files ?? []).map((f) => f.name);
  const text =
    input.text.length > INPUT_CHARS
      ? `${input.text.slice(0, INPUT_CHARS)}…`
      : input.text;
  return names.length ? `${text}\n\nFiles: ${names.join(", ")}` : text;
};

const corrections = (tx: Tx, caseIds: string[]) =>
  tx
    .select({
      caseId: reviewEvents.caseId,
      path: reviewEvents.path,
      before: reviewEvents.before,
      at: reviewEvents.at,
    })
    .from(reviewEvents)
    .where(
      and(
        inArray(reviewEvents.caseId, caseIds),
        inArray(reviewEvents.kind, CORRECTIONS),
        isNotNull(reviewEvents.path),
        sql`${reviewEvents.before} is distinct from ${reviewEvents.after}`,
      ),
    )
    .orderBy(asc(reviewEvents.at), asc(reviewEvents.id));

// A case completed: its row is written, or rewritten after a Rerun.
export const indexCase = async (
  tx: Tx,
  entry: {
    organizationId: string;
    caseId: string;
    input: StartCase["input"];
    answer: string | null;
    answers: Record<string, unknown> | null;
    completedAt: Date;
  },
) => {
  const [found] = await tx
    .select({
      agentId: cases.agentId,
      title: cases.title,
      environment: deployments.environment,
    })
    .from(cases)
    .innerJoin(deployments, eq(deployments.id, cases.deploymentId))
    .where(eq(cases.id, entry.caseId));
  if (!found) return;
  const changed = new Set(
    (await corrections(tx, [entry.caseId])).map((e) => e.path!),
  );
  const values = {
    organizationId: entry.organizationId,
    caseId: entry.caseId,
    agentId: found.agentId,
    environment: found.environment,
    title: found.title,
    input: inputText(entry.input),
    inputHash: await inputHash(tx, entry.caseId, entry.input.text),
    answer: entry.answer,
    answers: entry.answers,
    changed: [...changed].sort(),
    completedAt: entry.completedAt,
    updatedAt: entry.completedAt,
  };
  await tx
    .insert(caseSearch)
    .values(values)
    .onConflictDoUpdate({ target: caseSearch.caseId, set: values });
};

// A person changed an answer: a completed case's row follows it. A case that
// has not completed has no row yet, and gets one with the change when it does.
export const applyCorrection = async (
  tx: Tx,
  caseId: string,
  change: { kind: string; path: string; after: unknown },
) => {
  if (!CORRECTIONS.includes(change.kind)) return;
  const [row] = await tx
    .select({ answers: caseSearch.answers, changed: caseSearch.changed })
    .from(caseSearch)
    .innerJoin(cases, eq(cases.id, caseSearch.caseId))
    .where(and(eq(caseSearch.caseId, caseId), eq(cases.status, "completed")));
  if (!row) return;
  await tx
    .update(caseSearch)
    .set({
      answers: withValue(row.answers, change.path, change.after),
      changed: [...new Set([...row.changed, change.path])].sort(),
      updatedAt: new Date(),
    })
    .where(eq(caseSearch.caseId, caseId));
};

// Words and numbers from the agent's query, each matched as a prefix, any of
// them matching; ranking puts cases that match more of them first.
const tsquery = (query: string) =>
  (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .slice(0, QUERY_TERMS)
    .map((term) => `${term}:*`)
    .join(" | ");

export type SearchRequest = {
  organizationId: string;
  agentId: string;
  deploymentId: string;
  // The case searching, which never finds itself.
  caseId: string;
  query: string;
  limit?: number;
  // An eval case: the suite case it replays and that case's input text.
  eval?: { sourceCaseId: string; input: string };
};

export type FoundCase = {
  id: string;
  title: string | null;
  completedAt: string;
  input: string;
  answer: string | null;
  answers: Record<string, unknown> | null;
  // Answer paths a person changed.
  changed: string[];
};

// Answers as they stood at the cutoff: every path a person first changed at
// or after it goes back to its value before that change, and only paths
// changed before it count as changed. A case that matched only through a
// later correction no longer matches and drops out.
const asOf = async (
  tx: Tx,
  found: FoundCase[],
  cutoff: Date,
  query: string,
) => {
  if (!found.length) return found;
  const events = await corrections(
    tx,
    found.map((f) => f.id),
  );
  const rewritten = found.map((f) => {
    const earlier = new Set<string>();
    const later = new Map<string, unknown>();
    for (const e of events) {
      if (e.caseId !== f.id) continue;
      if (e.at < cutoff) earlier.add(e.path!);
      else if (!later.has(e.path!)) later.set(e.path!, e.before);
    }
    let answers = f.answers;
    for (const [path, before] of later)
      answers = withValue(answers, path, before);
    return {
      ...f,
      answers: answers,
      changed: [...earlier].sort(),
      rewound: later.size > 0,
    };
  });
  const rewound = rewritten.filter((f) => f.rewound);
  const { rows } = rewound.length
    ? await tx.execute<{ id: string }>(
        sql`select x->>'id' as id from jsonb_array_elements(${JSON.stringify(rewound)}::jsonb) x where (to_tsvector('simple', coalesce(x->>'title', '')) || jsonb_to_tsvector('simple', coalesce(x->'answers', '{}'::jsonb), '["string", "numeric"]') || to_tsvector('simple', coalesce(x->>'answer', '')) || to_tsvector('simple', x->>'input')) @@ to_tsquery('simple', ${query})`,
      )
    : { rows: [] };
  const still = new Set(rows.map((r) => r.id));
  return rewritten
    .filter((f) => !f.rewound || still.has(f.id))
    .map(({ rewound: _, ...f }) => f);
};

export const searchCases = (env: DbEnv, request: SearchRequest) =>
  withOrg(env, orgId(request.organizationId), async (tx) => {
    const query = tsquery(request.query);
    if (!query) return { cases: [] as FoundCase[] };
    const limit = Math.min(
      Math.max(Math.trunc(request.limit ?? 5), 1),
      SEARCH_LIMIT,
    );
    // An eval case searches the world of the case it replays: that case's
    // environment, before it started.
    const [anchor] = await tx
      .select({
        environment: deployments.environment,
        startedAt: cases.createdAt,
      })
      .from(cases)
      .innerJoin(deployments, eq(deployments.id, cases.deploymentId))
      .where(
        and(
          eq(cases.agentId, request.agentId),
          eq(cases.id, request.eval?.sourceCaseId ?? request.caseId),
        ),
      );
    const environment = request.eval
      ? anchor?.environment
      : (
          await tx
            .select({ environment: deployments.environment })
            .from(deployments)
            .where(
              and(
                eq(deployments.id, request.deploymentId),
                eq(deployments.agentId, request.agentId),
              ),
            )
        )[0]?.environment;
    if (!environment || (request.eval && !anchor))
      return { cases: [] as FoundCase[] };
    const cutoff = request.eval ? anchor!.startedAt : null;
    const hash = request.eval
      ? await inputHash(tx, request.eval.sourceCaseId, request.eval.input)
      : null;
    const q = sql`to_tsquery('simple', ${query})`;
    const rows = await tx
      .select({
        id: caseSearch.caseId,
        title: caseSearch.title,
        completedAt: caseSearch.completedAt,
        input: caseSearch.input,
        answer: caseSearch.answer,
        answers: caseSearch.answers,
        changed: caseSearch.changed,
      })
      .from(caseSearch)
      .innerJoin(cases, eq(cases.id, caseSearch.caseId))
      .where(
        and(
          eq(caseSearch.agentId, request.agentId),
          eq(caseSearch.environment, environment),
          eq(cases.status, "completed"),
          sql`${caseSearch.document} @@ ${q}`,
          ne(caseSearch.caseId, request.caseId),
          ...(request.eval
            ? [
                ne(caseSearch.caseId, request.eval.sourceCaseId),
                ne(caseSearch.inputHash, hash!),
                lt(caseSearch.completedAt, cutoff!),
              ]
            : []),
        ),
      )
      .orderBy(
        desc(sql`ts_rank(${caseSearch.document}, ${q})`),
        desc(caseSearch.completedAt),
      )
      .limit(cutoff ? limit + SEARCH_LIMIT : limit);
    const found = rows.map((r) => ({
      ...r,
      completedAt: r.completedAt.toISOString(),
    }));
    return {
      cases: cutoff
        ? (await asOf(tx, found, cutoff, query)).slice(0, limit)
        : found,
    };
  });
