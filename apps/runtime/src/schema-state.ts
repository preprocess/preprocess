import type {
  CheckResult,
  EvaluateRequest,
  EvaluateResponse,
  FieldEval,
  Manifest,
  OptionsRequest,
  OptionsResponse,
  Path,
  SchemaNode,
  SchemaOption,
} from "@preprocess/sdk/protocol";

// A case's answers, evaluated against the agent's output schema (design doc
// 05). Answers are flat by path in the case object's SQLite; every dynamic
// part of the schema is evaluated by the agent's Worker, which reports the
// paths each field read, and those reads are the dependency graph.

export type AnswerStatus = "agent" | "confirmed" | "stale";
export type StaleReason = { path: Path; from: unknown; to: unknown };
export type Writer = { agent: true } | { person: string };

export type Answer = {
  path: Path;
  value: unknown;
  status: AnswerStatus;
  setBy: string;
  setAt: number;
  staleBecause: StaleReason[] | null;
  suggestedValue?: unknown;
  suggestedAt: number | null;
  version: number;
};

export type FieldView = {
  path: Path;
  kind: SchemaNode["kind"];
  description?: string;
  visible: boolean;
  hiddenBecause: Array<{ path: Path; value: unknown }> | null;
  review: "required" | "none";
  options: FieldEval["options"] | null;
  error: string | null;
  answer: Answer | null;
};

export type WriteResult =
  | {
      result: "ok" | "suggested" | "unchanged";
      path: Path;
      before: unknown;
      after: unknown;
      stale: Path[];
      shown: Path[];
      hidden: Path[];
    }
  | { result: "refused"; path: Path; reason: string }
  // A person sent a version that is no longer current: someone (or the
  // agent) changed the field since they loaded it.
  | { result: "conflict"; path: Path; version: number };

type AgentWorker = {
  fetch(path: string, init?: RequestInit): Promise<Response>;
};

type AnswerRow = {
  path: string;
  value: string | null;
  status: AnswerStatus;
  set_by: string;
  set_at: number;
  stale_because: string | null;
  suggested_value: string | null;
  suggested_at: number | null;
  version: number;
};

type FieldRow = {
  path: string;
  visible: number;
  hidden_because: string | null;
  options_meta: string | null;
  review: "required" | "none";
  error: string | null;
};

export const SCHEMA_TABLES = `
CREATE TABLE IF NOT EXISTS answers (path TEXT PRIMARY KEY, value TEXT, status TEXT NOT NULL, set_by TEXT NOT NULL, set_at INTEGER NOT NULL, stale_because TEXT, suggested_value TEXT, suggested_at INTEGER, version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS field_state (path TEXT PRIMARY KEY, visible INTEGER NOT NULL, hidden_because TEXT, options_meta TEXT, review TEXT NOT NULL, error TEXT, evaluated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS deps (path TEXT NOT NULL, reads TEXT NOT NULL, PRIMARY KEY (path, reads));
CREATE INDEX IF NOT EXISTS deps_reads ON deps (reads);
CREATE TABLE IF NOT EXISTS fetched (path TEXT PRIMARY KEY, key TEXT NOT NULL, data TEXT, fetched_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS checks (name TEXT PRIMARY KEY, ok INTEGER NOT NULL, field TEXT, message TEXT);
CREATE TABLE IF NOT EXISTS approval_rules (target TEXT PRIMARY KEY, grp TEXT);`;

// What /schema/evaluate adds for approvals (PLAT-39's SDK): a field's rule
// when it is visible and applies, and the completion rule when it applies.
// Empty target is completion.
type ApprovalRule = { group: string | null };
type Evaluated = EvaluateResponse & {
  approval?: ApprovalRule;
  fields: Record<Path, FieldEval & { approval?: ApprovalRule }>;
};

const json = (value: unknown) => JSON.stringify(value ?? null);
const parse = <T>(text: string | null): T | null =>
  text === null ? null : (JSON.parse(text) as T);
const same = (a: unknown, b: unknown) => json(a) === json(b);

// "lines[2].glAccount" → ["lines", 2, "glAccount"]
export const segments = (path: Path): Array<string | number> =>
  path.split(".").flatMap((part) => {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!match) return [part];
    const indices = [...(match[2] ?? "").matchAll(/\[(\d+)\]/g)].map((m) =>
      Number(m[1]),
    );
    return [match[1]!, ...indices];
  });

export const comparePaths = (a: Path, b: Path) => {
  const x = segments(a);
  const y = segments(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (typeof x[i] === "number" && typeof y[i] === "number")
      return (x[i] as number) - (y[i] as number);
    return 0;
  }
  return x.length - y.length;
};

const shape = (path: Path) => path.replace(/\[\d+\]/g, "[]");

const MAX_PROPAGATION = 6;
const MAX_DECIDE_OPTIONS = 10_000;

export class SchemaState {
  private readonly order = new Map<string, number>();

  constructor(
    private readonly sql: SqlStorage,
    private readonly manifest: Manifest,
    private readonly worker: () => AgentWorker,
    private readonly caseId: string,
  ) {
    let i = 0;
    const walk = (node: SchemaNode, at: string) => {
      this.order.set(at, i++);
      for (const [name, child] of Object.entries(node.fields ?? {}))
        walk(child, at ? `${at}.${name}` : name);
      if (node.item) walk(node.item, `${at}[]`);
    };
    if (manifest.schema) walk(manifest.schema.root, "");
  }

  get enabled() {
    return Boolean(this.manifest.schema);
  }

  node(path: Path): SchemaNode | null {
    let node: SchemaNode | undefined = this.manifest.schema?.root;
    for (const part of segments(path)) {
      if (!node) return null;
      node = typeof part === "number" ? node.item : node.fields?.[part];
    }
    return node ?? null;
  }

  private sortFields<T extends { path: Path }>(rows: T[]) {
    return rows.sort(
      (a, b) =>
        (this.order.get(shape(a.path)) ?? 0) -
          (this.order.get(shape(b.path)) ?? 0) || comparePaths(a.path, b.path),
    );
  }

  values(): Record<Path, unknown> {
    return Object.fromEntries(
      this.sql
        .exec<{ path: string; value: string | null }>(
          "SELECT path, value FROM answers WHERE value IS NOT NULL",
        )
        .toArray()
        .map((row) => [row.path, parse(row.value)]),
    );
  }

  answer(path: Path): Answer | null {
    const row = this.sql
      .exec<AnswerRow>("SELECT * FROM answers WHERE path = ?", path)
      .toArray()[0];
    return row ? toAnswer(row) : null;
  }

  fields(): FieldView[] {
    const answers = new Map(
      this.sql
        .exec<AnswerRow>("SELECT * FROM answers")
        .toArray()
        .map((row) => [row.path, toAnswer(row)]),
    );
    return this.sortFields(
      this.sql
        .exec<FieldRow>("SELECT * FROM field_state")
        .toArray()
        .map((row) => {
          const node = this.node(row.path);
          return {
            path: row.path,
            kind: node?.kind ?? "text",
            ...(node?.description && { description: node.description }),
            visible: row.visible === 1,
            hiddenBecause: parse(row.hidden_because),
            review: row.review,
            options: parse<FieldEval["options"]>(row.options_meta),
            error: row.error,
            answer: answers.get(row.path) ?? null,
          };
        }),
    );
  }

  checks(): CheckResult[] {
    return this.sql
      .exec<{
        name: string;
        ok: number;
        field: string | null;
        message: string | null;
      }>("SELECT * FROM checks ORDER BY name")
      .toArray()
      .map((row) => ({
        name: row.name,
        ok: row.ok === 1,
        ...(row.field !== null && { field: row.field }),
        ...(row.message !== null && { message: row.message }),
      }));
  }

  // Visible fields that need a person's review and have no confirmed answer
  // yet: what the inbox lists as fields to review.
  unreviewed(): Path[] {
    return this.fields()
      .filter(
        (f) =>
          f.visible &&
          f.review === "required" &&
          f.answer?.status !== "confirmed",
      )
      .map((f) => f.path);
  }

  // The current answers as the nested object a caller receives: visible
  // fields only, hidden values excluded (design doc 05).
  output(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of this.fields()) {
      if (!field.visible || !field.answer || field.answer.value === null)
        continue;
      let target: Record<string | number, unknown> = out;
      const parts = segments(field.path);
      parts.forEach((part, i) => {
        if (i === parts.length - 1) {
          target[part] = field.answer!.value;
          return;
        }
        const next = parts[i + 1];
        target[part] ??= typeof next === "number" ? [] : {};
        target = target[part] as Record<string | number, unknown>;
      });
    }
    return out;
  }

  // The approvals the code requires as of the last evaluation: "" for
  // completion, else a field path.
  approvalRules(): Array<{ target: string; group: string | null }> {
    return this.sql
      .exec<{ target: string; grp: string | null }>(
        "SELECT target, grp FROM approval_rules ORDER BY target",
      )
      .toArray()
      .map((row) => ({ target: row.target, group: row.grp }));
  }

  // A field's value as the output holds it, a whole subtree for a group or
  // list.
  valueAt(path: Path): unknown {
    let value: unknown = this.output();
    for (const part of segments(path)) {
      if (value === null || typeof value !== "object") return null;
      value = (value as Record<string | number, unknown>)[part];
    }
    return value ?? null;
  }

  async evaluate(targets: Path[] | "all", depth = 0): Promise<void> {
    if (!this.enabled || (targets !== "all" && targets.length === 0)) return;
    const request: EvaluateRequest = {
      caseId: this.caseId,
      answers: this.values(),
      fetched: Object.fromEntries(
        this.sql
          .exec<{ path: string; key: string; data: string | null }>(
            "SELECT path, key, data FROM fetched",
          )
          .toArray()
          .map((row) => [row.path, { key: row.key, data: parse(row.data) }]),
      ),
      targets,
    };
    const response = await this.worker().fetch("/schema/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok)
      throw new Error(
        `agent Worker answered ${response.status} to /schema/evaluate`,
      );
    const result = await response.json<Evaluated>();
    if (targets === "all") {
      this.sql.exec("DELETE FROM approval_rules");
      if (result.approval)
        this.sql.exec(
          "INSERT INTO approval_rules (target, grp) VALUES ('', ?)",
          result.approval.group,
        );
    }
    for (const [path, field] of Object.entries(result.fields)) {
      this.sql.exec("DELETE FROM approval_rules WHERE target = ?", path);
      if (field.approval && field.visible)
        this.sql.exec(
          "INSERT INTO approval_rules (target, grp) VALUES (?, ?)",
          path,
          field.approval.group,
        );
    }
    const now = Date.now();
    const changed: Array<{ path: Path; from: unknown; to: unknown }> = [];

    if (targets === "all") {
      const keep = new Set(Object.keys(result.fields));
      for (const { path } of this.sql
        .exec<{ path: string }>("SELECT path FROM field_state")
        .toArray())
        if (!keep.has(path)) {
          this.sql.exec("DELETE FROM field_state WHERE path = ?", path);
          this.sql.exec("DELETE FROM deps WHERE path = ?", path);
        }
    }

    for (const [path, field] of Object.entries(result.fields)) {
      const hiddenBecause = field.visible
        ? null
        : field.reads.map((read) => ({
            path: read,
            value: request.answers[read] ?? null,
          }));
      this.sql.exec(
        `INSERT INTO field_state (path, visible, hidden_because, options_meta, review, error, evaluated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET visible = excluded.visible, hidden_because = excluded.hidden_because,
           options_meta = excluded.options_meta, review = excluded.review, error = excluded.error, evaluated_at = excluded.evaluated_at`,
        path,
        field.visible ? 1 : 0,
        hiddenBecause ? json(hiddenBecause) : null,
        field.options ? json(field.options) : null,
        field.review,
        field.error ?? null,
        now,
      );
      this.sql.exec("DELETE FROM deps WHERE path = ?", path);
      for (const read of new Set(field.reads))
        this.sql.exec(
          "INSERT INTO deps (path, reads) VALUES (?, ?)",
          path,
          read,
        );
      if (field.fetch)
        this.sql.exec(
          `INSERT INTO fetched (path, key, data, fetched_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (path) DO UPDATE SET key = excluded.key, data = excluded.data, fetched_at = excluded.fetched_at`,
          path,
          field.fetch.key,
          json(field.fetch.data),
          now,
        );
      if (this.node(path)?.kind === "fetched" && "value" in field) {
        const before = this.answer(path);
        if (!before || !same(before.value, field.value)) {
          this.store(path, field.value, "agent", "agent", before);
          changed.push({ path, from: before?.value ?? null, to: field.value });
        }
      }
    }

    if (targets === "all") this.sql.exec("DELETE FROM checks");
    for (const check of result.checks)
      this.sql.exec(
        `INSERT INTO checks (name, ok, field, message) VALUES (?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET ok = excluded.ok, field = excluded.field, message = excluded.message`,
        check.name,
        check.ok ? 1 : 0,
        check.field ?? null,
        check.message ?? null,
      );

    if (depth < MAX_PROPAGATION)
      for (const change of changed) await this.propagate(change, depth + 1);
  }

  private store(
    path: Path,
    value: unknown,
    status: AnswerStatus,
    setBy: string,
    before: Answer | null,
  ) {
    this.sql.exec(
      `INSERT INTO answers (path, value, status, set_by, set_at, stale_because, suggested_value, suggested_at, version)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
       ON CONFLICT (path) DO UPDATE SET value = excluded.value, status = excluded.status, set_by = excluded.set_by,
         set_at = excluded.set_at, stale_because = NULL, suggested_value = NULL, suggested_at = NULL, version = excluded.version`,
      path,
      value === null ? null : json(value),
      status,
      setBy,
      Date.now(),
      (before?.version ?? 0) + 1,
    );
  }

  // A value changed at `change.path`: every field that read it, and every
  // path its node declares in `invalidates`, is re-evaluated; those holding a
  // value become stale with the reason. Staleness does not cascade further on
  // its own, because a stale value has not changed.
  private async propagate(
    change: { path: Path; from: unknown; to: unknown },
    depth: number,
  ): Promise<Path[]> {
    const listPrefixes = segments(change.path)
      .map((_, i, parts) => parts.slice(0, i + 1))
      .filter((parts) => typeof parts[parts.length - 1] === "number")
      .map((parts) =>
        parts
          .reduce<string>(
            (s, p) =>
              typeof p === "number" ? `${s}[${p}]` : s ? `${s}.${p}` : p,
            "",
          )
          .replace(/\[\d+\]$/, ""),
      );
    const readers = this.sql
      .exec<{ path: string }>(
        `SELECT DISTINCT path FROM deps WHERE reads = ? ${listPrefixes.map(() => "OR reads = ?").join(" ")}`,
        change.path,
        ...listPrefixes,
      )
      .toArray()
      .map((row) => row.path);
    const invalidated = (this.node(change.path)?.invalidates ?? []).flatMap(
      (target) =>
        this.sql
          .exec<{ path: string }>("SELECT path FROM field_state")
          .toArray()
          .map((row) => row.path)
          .filter((p) => p === target || shape(p) === shape(target)),
    );
    const dependents = [...new Set([...readers, ...invalidated])].filter(
      (p) => p !== change.path,
    );
    const stale: Path[] = [];
    for (const path of dependents) {
      const answer = this.answer(path);
      if (!answer || answer.value === null) continue;
      if (this.node(path)?.kind === "fetched") continue;
      const reasons = [...(answer.staleBecause ?? []), change];
      this.sql.exec(
        "UPDATE answers SET status = 'stale', stale_because = ?, version = version + 1 WHERE path = ?",
        json(reasons),
        path,
      );
      stale.push(path);
    }
    await this.evaluate(dependents, depth);
    return stale;
  }

  async write(
    path: Path,
    value: unknown,
    by: Writer,
    expectVersion?: number,
  ): Promise<WriteResult> {
    if (
      value !== null &&
      /\[\d+\]/.test(path) &&
      this.node(path) &&
      !this.hasField(path)
    ) {
      // A new list item exists once something in it is answered: evaluate
      // with the value in place, and take it back if the item's field is
      // not there or hidden.
      this.store(path, value, "agent", "agent", null);
      await this.evaluate("all");
      this.sql.exec("DELETE FROM answers WHERE path = ?", path);
      if (!this.hasField(path))
        return { result: "refused", path, reason: "no such list item" };
    }
    const field = this.sql
      .exec<FieldRow>("SELECT * FROM field_state WHERE path = ?", path)
      .toArray()[0];
    const node = this.node(path);
    if (!field || !node)
      return { result: "refused", path, reason: "no such field" };
    if (["group", "list", "fetched"].includes(node.kind))
      return {
        result: "refused",
        path,
        reason: `${node.kind} fields cannot be answered`,
      };
    if (!field.visible)
      return {
        result: "refused",
        path,
        reason: `hidden: ${(
          parse<Array<{ path: string; value: unknown }>>(
            field.hidden_because,
          ) ?? []
        )
          .map((r) => `${r.path} = ${json(r.value)}`)
          .join(", ")}`,
      };
    if (value !== null) {
      const problem = await this.validate(path, node, field, value);
      if (problem) return { result: "refused", path, reason: problem };
    }

    const before = this.answer(path);
    const person = "person" in by;
    if (
      person &&
      expectVersion !== undefined &&
      expectVersion !== (before?.version ?? 0)
    )
      return { result: "conflict", path, version: before?.version ?? 0 };

    const held =
      before &&
      (before.status === "confirmed" || before.setBy.startsWith("person:"));
    if (!person && held) {
      if (same(before.value, value) || same(before.suggestedValue, value))
        return {
          result: "unchanged",
          path,
          before: before.value,
          after: before.value,
          stale: [],
          shown: [],
          hidden: [],
        };
      this.sql.exec(
        "UPDATE answers SET suggested_value = ?, suggested_at = ?, version = version + 1 WHERE path = ?",
        json(value),
        Date.now(),
        path,
      );
      return {
        result: "suggested",
        path,
        before: before.value,
        after: before.value,
        stale: [],
        shown: [],
        hidden: [],
      };
    }

    const visibleBefore = this.visibility();
    this.store(
      path,
      value,
      person ? "confirmed" : "agent",
      person ? `person:${by.person}` : "agent",
      before,
    );
    const from = before?.value ?? null;
    const stale = same(from, value)
      ? []
      : await this.propagate({ path, from, to: value }, 1);
    const visibleAfter = this.visibility();
    return {
      result: "ok",
      path,
      before: from,
      after: value,
      stale,
      shown: [...visibleAfter]
        .filter(([p, v]) => v && visibleBefore.get(p) === false)
        .map(([p]) => p),
      hidden: [...visibleAfter]
        .filter(([p, v]) => !v && visibleBefore.get(p) !== false)
        .map(([p]) => p),
    };
  }

  private hasField(path: Path) {
    return (
      this.sql.exec("SELECT 1 FROM field_state WHERE path = ?", path).toArray()
        .length > 0
    );
  }

  // A person confirms the value as it stands.
  confirm(path: Path, expectVersion: number): WriteResult {
    const before = this.answer(path);
    if (!before || before.value === null)
      return { result: "refused", path, reason: "nothing to confirm" };
    if (expectVersion !== before.version)
      return { result: "conflict", path, version: before.version };
    this.sql.exec(
      "UPDATE answers SET status = 'confirmed', stale_because = NULL, version = version + 1 WHERE path = ?",
      path,
    );
    return {
      result: "ok",
      path,
      before: before.value,
      after: before.value,
      stale: [],
      shown: [],
      hidden: [],
    };
  }

  private visibility() {
    return new Map(
      this.sql
        .exec<{ path: string; visible: number }>(
          "SELECT path, visible FROM field_state",
        )
        .toArray()
        .map((row) => [row.path, row.visible === 1]),
    );
  }

  private async validate(
    path: Path,
    node: SchemaNode,
    field: FieldRow,
    value: unknown,
  ) {
    switch (node.kind) {
      case "text":
        return typeof value === "string" ? null : "expects text";
      case "number":
        return typeof value === "number" && Number.isFinite(value)
          ? null
          : "expects a number";
      case "boolean":
        return typeof value === "boolean" ? null : "expects true or false";
      case "date":
        return typeof value === "string" &&
          /^\d{4}-\d{2}-\d{2}/.test(value) &&
          !Number.isNaN(Date.parse(value))
          ? null
          : "expects an ISO date (YYYY-MM-DD)";
      case "select":
      case "multiselect": {
        const ids = node.kind === "select" ? [value] : value;
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
          return node.kind === "select"
            ? "expects one option id"
            : "expects a list of option ids";
        const options = parse<FieldEval["options"]>(field.options_meta);
        const known =
          options?.kind === "inline"
            ? new Set(options.items.map((o) => o.id))
            : new Set(
                (
                  await this.options({
                    path,
                    ids: ids as string[],
                    limit: ids.length || 1,
                  })
                ).items.map((o) => o.id),
              );
        const missing = (ids as string[]).filter((id) => !known.has(id));
        return missing.length ? `not an option: ${missing.join(", ")}` : null;
      }
      default:
        return null;
    }
  }

  async options(
    request: Omit<OptionsRequest, "caseId" | "answers">,
  ): Promise<OptionsResponse> {
    const response = await this.worker().fetch("/schema/options", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...request,
        caseId: this.caseId,
        answers: this.values(),
      }),
    });
    if (!response.ok)
      throw new Error(
        `agent Worker answered ${response.status} to /schema/options`,
      );
    return response.json<OptionsResponse>();
  }

  // Every option of a field, for decide: inline lists as evaluated, sources
  // paged in full on the platform side. The list never enters the model's
  // context.
  async allOptions(path: Path): Promise<SchemaOption[]> {
    const field = this.sql
      .exec<FieldRow>("SELECT * FROM field_state WHERE path = ?", path)
      .toArray()[0];
    const meta = parse<FieldEval["options"]>(field?.options_meta ?? null);
    if (!meta) return [];
    if (meta.kind === "inline") return meta.items;
    const items: SchemaOption[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.options({
        path,
        limit: 200,
        ...(cursor && { cursor }),
      });
      items.push(...page.items);
      cursor = page.cursor;
    } while (cursor && items.length < MAX_DECIDE_OPTIONS);
    return items;
  }

  overview(): string {
    if (!this.enabled) return "";
    const fields = this.fields();
    const lines: string[] = [];
    const describe = (f: FieldView) => {
      const parts = [`${f.path} (${f.kind}`];
      if (f.options?.kind === "inline")
        parts[0] += `, ${f.options.items.length} options`;
      if (f.options?.kind === "source")
        parts[0] +=
          f.options.count !== undefined
            ? `, ${f.options.count} options to search`
            : ", options to search";
      if (f.review === "required") parts[0] += ", review required";
      parts[0] += ")";
      if (!f.visible) {
        parts.push(
          `hidden: ${(f.hiddenBecause ?? []).map((r) => `${r.path} = ${summary(r.value)}`).join(", ")}`,
        );
        return parts.join(": ");
      }
      const a = f.answer;
      if (!a || a.value === null) parts.push("empty");
      else {
        const who = a.setBy.startsWith("person:") ? "a person" : "agent";
        parts.push(`${a.status} (${who}) ${summary(a.value)}`);
        if (a.status === "stale" && a.staleBecause)
          parts.push(
            `stale because ${a.staleBecause.map((r) => `${r.path} changed ${summary(r.from)} → ${summary(r.to)}`).join("; ")}`,
          );
        if (a.suggestedValue !== undefined)
          parts.push(
            `your suggestion ${summary(a.suggestedValue)} awaits a person`,
          );
      }
      if (f.error) parts.push(`error: ${f.error}`);
      return parts.join(": ");
    };

    const lists = new Map<string, FieldView[]>();
    for (const f of fields) {
      const match = /^(.*?)\[(\d+)\]/.exec(f.path);
      if (match) {
        const key = match[1]!;
        lists.set(key, [...(lists.get(key) ?? []), f]);
      }
    }
    const summarised = new Set<string>();
    for (const [list, items] of lists) {
      const count = new Set(items.map((f) => /\[(\d+)\]/.exec(f.path)![1]))
        .size;
      if (count <= 20) continue;
      summarised.add(list);
    }
    const done = new Set<string>();
    for (const f of fields) {
      const list = /^(.*?)\[/.exec(f.path)?.[1];
      if (list && summarised.has(list)) {
        if (!done.has(list)) {
          done.add(list);
          const items = lists.get(list)!;
          const count = new Set(items.map((i) => /\[(\d+)\]/.exec(i.path)![1]))
            .size;
          const tally = (s: string) =>
            items.filter((i) => (i.answer?.status ?? "empty") === s).length;
          lines.push(
            `${list}[0..${count - 1}]: ${count} items, fields ${tally("agent")} agent, ${tally("confirmed")} confirmed, ${tally("stale")} stale, ${tally("empty")} empty (schema_read the list for everything)`,
          );
        }
        const notable =
          f.answer?.status === "stale" ||
          (f.visible && !f.answer && f.review === "required") ||
          this.checks().some((c) => !c.ok && c.field === f.path);
        if (notable) lines.push(`  ${describe(f)}`);
        continue;
      }
      lines.push(describe(f));
    }
    const failing = this.checks().filter((c) => !c.ok);
    if (failing.length)
      lines.push(
        "Failing checks:",
        ...failing.map(
          (c) =>
            `  ${c.name}${c.field ? ` (${c.field})` : ""}: ${c.message ?? "fails"}`,
        ),
      );
    return lines.join("\n");
  }

  read(paths: Path[]) {
    const fields = this.fields();
    const wanted = (p: Path) =>
      paths.some(
        (q) => p === q || p.startsWith(`${q}.`) || p.startsWith(`${q}[`),
      );
    return fields
      .filter((f) => wanted(f.path))
      .map((f) => ({
        ...f,
        reads: this.sql
          .exec<{ reads: string }>(
            "SELECT reads FROM deps WHERE path = ?",
            f.path,
          )
          .toArray()
          .map((r) => ({
            path: r.reads,
            value: this.answer(r.reads)?.value ?? null,
          })),
        fetched: parse(
          this.sql
            .exec<{ data: string | null }>(
              "SELECT data FROM fetched WHERE path = ?",
              f.path,
            )
            .toArray()[0]?.data ?? null,
        ),
        checks: this.checks().filter((c) => c.field === f.path),
      }));
  }
}

const toAnswer = (row: AnswerRow): Answer => ({
  path: row.path,
  value: parse(row.value),
  status: row.status,
  setBy: row.set_by,
  setAt: row.set_at,
  staleBecause: parse(row.stale_because),
  ...(row.suggested_value !== null && {
    suggestedValue: parse(row.suggested_value),
  }),
  suggestedAt: row.suggested_at,
  version: row.version,
});

const summary = (value: unknown) => {
  const text = json(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};
