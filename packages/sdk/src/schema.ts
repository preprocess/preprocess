import type {
  CheckResult,
  EvaluateRequest,
  EvaluateResponse,
  FieldEval,
  FieldKind,
  OptionsRequest,
  OptionsResponse,
  ApprovalRule,
  Path,
  ReviewRequirement,
  SchemaManifest,
  SchemaNode,
  SchemaOption,
} from "./protocol.ts";

export type Answers = {
  get(path: Path): unknown;
  fetched(path: Path): unknown;
  sum(pattern: string): number;
  all(pattern: string): unknown[];
  sibling(name: string): unknown;
};

export type FunctionContext = {
  env: Readonly<Record<string, string | undefined>>;
  caseId: string;
};

type OptionLike = SchemaOption | string;

export type SourceResult =
  OptionLike[] | { items: OptionLike[]; cursor?: string; total?: number };

type SourceQuery = FunctionContext & {
  cursor?: string;
  limit: number;
  a: Answers;
};

const SOURCE = Symbol("preprocess.schema.source");
const FIELD = Symbol("preprocess.schema.field");

export type Source = {
  readonly [SOURCE]: true;
  search: (
    query: string,
    ctx: SourceQuery,
  ) => SourceResult | Promise<SourceResult>;
  get: (
    ids: string[],
    ctx: FunctionContext & { a: Answers },
  ) => SourceResult | Promise<SourceResult>;
  page?: (ctx: SourceQuery) => SourceResult | Promise<SourceResult>;
};

export type Review = ReviewRequirement | ((a: Answers) => ReviewRequirement);

export type Check = (
  a: Answers,
) => true | false | string | { field: Path; message: string };

// When the case is done (design doc 05), over its answers whoever entered
// them: true, or false or a message saying what is missing.
export type Success = (
  a: Answers & { allReviewed(): boolean },
) => boolean | string;

// Done once every visible field that needs review has a person's answer.
export const allReviewed: Success = (a) => a.allReviewed();

type Options = OptionLike[] | ((a: Answers) => OptionLike[]) | Source;

// Approval by a person: true is any operator; a group names who approves,
// and `when` decides per case or call. `when` runs synchronously.
export type Approval<X> = true | { group?: string; when?: (x: X) => boolean };

export type FieldOptions = {
  description?: string;
  visible?: (a: Answers) => boolean;
  review?: Review;
  // Approval of this field's value (a group or list: its whole subtree).
  approval?: Approval<Answers>;
  invalidates?: Path[];
};

export type Field = FieldOptions & {
  readonly [FIELD]: true;
  readonly kind: FieldKind;
  readonly options?: Options;
  readonly fields?: Record<string, Field>;
  readonly item?: Field;
  readonly checks?: Record<string, Check>;
  readonly success?: Success;
  readonly inputs?: (a: Answers) => unknown;
  readonly fetch?: (inputs: unknown, ctx: FunctionContext) => unknown;
  readonly transform?: (data: unknown) => unknown;
};

export type Group = Field & { readonly kind: "group" };

const field = (
  kind: FieldKind,
  opts: FieldOptions & Partial<Omit<Field, typeof FIELD | "kind">> = {},
): Field => ({ ...opts, [FIELD]: true, kind });

export const schema = {
  group: (
    fields: Record<string, Field>,
    opts: FieldOptions & {
      checks?: Record<string, Check>;
      success?: Success;
    } = {},
  ): Group => field("group", { ...opts, fields }) as Group,
  list: (item: Field, opts: FieldOptions = {}): Field =>
    field("list", { ...opts, item }),
  text: (opts?: FieldOptions): Field => field("text", opts),
  number: (opts?: FieldOptions): Field => field("number", opts),
  boolean: (opts?: FieldOptions): Field => field("boolean", opts),
  date: (opts?: FieldOptions): Field => field("date", opts),
  select: (opts: FieldOptions & { options: Options }): Field =>
    field("select", opts),
  multiselect: (opts: FieldOptions & { options: Options }): Field =>
    field("multiselect", opts),
  fetched: <I, D, V = D>(
    opts: FieldOptions & {
      inputs: (a: Answers) => I;
      fetch: (inputs: I, ctx: FunctionContext) => D | Promise<D>;
      transform?: (data: Awaited<D>) => V;
    },
  ): Field =>
    field("fetched", opts as Partial<Omit<Field, typeof FIELD | "kind">>),
  source: (definition: Omit<Source, typeof SOURCE>): Source => ({
    ...definition,
    [SOURCE]: true,
  }),
};

const NAME = /^[a-zA-Z][a-zA-Z0-9_]*$/;

const ANY = -1;

type Segment = string | number;

const parsePath = (path: Path): Segment[] => {
  if (path === "") return [];
  return path.split(".").flatMap((part) => {
    const match = /^([a-zA-Z][a-zA-Z0-9_]*)((?:\[(?:\d+|\*)\])*)$/.exec(part);
    if (!match?.[1]) throw new Error(`Invalid path ${path}`);
    return [
      match[1],
      ...[...(match[2] ?? "").matchAll(/\[(\d+|\*)\]/g)].map(
        ([, index]): Segment => (index === "*" ? ANY : Number(index)),
      ),
    ];
  });
};

const child = (path: Path, segment: Segment): Path =>
  typeof segment === "string"
    ? path
      ? `${path}.${segment}`
      : segment
    : `${path}[${segment}]`;

const isField = (value: unknown): value is Field =>
  typeof value === "object" && value !== null && FIELD in value;

const isSource = (value: unknown): value is Source =>
  typeof value === "object" && value !== null && SOURCE in value;

type Step = { node: Field; path: Path };

const resolve = (root: Field, segments: Segment[]): Step[] | null => {
  const chain: Step[] = [{ node: root, path: "" }];
  for (const segment of segments) {
    const { node, path } = chain[chain.length - 1]!;
    const next =
      typeof segment === "string"
        ? node.kind === "group"
          ? Object.hasOwn(node.fields ?? {}, segment)
            ? node.fields?.[segment]
            : undefined
          : undefined
        : node.kind === "list"
          ? node.item
          : undefined;
    if (!next) return null;
    chain.push({ node: next, path: child(path, segment) });
  }
  return chain;
};

const normalise = (items: OptionLike[]): SchemaOption[] =>
  items.map((item) =>
    typeof item === "string" ? { id: item, label: item } : item,
  );

export const schemaProblems = (root: unknown): string[] => {
  if (!isField(root) || root.kind !== "group")
    return ["schema must be a group made with schema.group()"];
  const problems: string[] = [];
  const visit = (node: unknown, path: Path) => {
    const label = path || "root";
    if (!isField(node)) {
      problems.push(
        `schema field ${label} is not made with the schema builders`,
      );
      return;
    }
    if (node.checks && path)
      problems.push(`checks are only allowed on the root group (${label})`);
    for (const name of Object.keys(node.checks ?? {}))
      if (!NAME.test(name)) problems.push(`check ${name} must match ${NAME}`);
    for (const target of node.invalidates ?? []) {
      let segments: Segment[] | null = null;
      try {
        segments = parsePath(target);
      } catch {
        segments = null;
      }
      if (!segments || !resolve(root, segments))
        problems.push(`${label} invalidates unknown path ${target}`);
    }
    if (node.kind === "group") {
      for (const [name, value] of Object.entries(node.fields ?? {})) {
        if (!NAME.test(name))
          problems.push(`field ${child(path, name)} must match ${NAME}`);
        visit(value, child(path, name));
      }
    }
    if (node.kind === "list") visit(node.item, `${path}[*]`);
    if (node.kind === "select" || node.kind === "multiselect") {
      const { options } = node;
      if (Array.isArray(options)) {
        const ids = normalise(options).map((option) => option.id);
        if (ids.some((id) => typeof id !== "string" || !id))
          problems.push(`${label} has an option without an id`);
        if (new Set(ids).size !== ids.length)
          problems.push(`${label} has duplicate option ids`);
      } else if (typeof options !== "function" && !isSource(options)) {
        problems.push(
          `${label} needs options: an array, a function or schema.source()`,
        );
      }
    }
    if (
      node.kind === "fetched" &&
      (typeof node.inputs !== "function" || typeof node.fetch !== "function")
    )
      problems.push(`${label} needs inputs and fetch functions`);
  };
  visit(root, "");
  return problems;
};

export const approvalRule = (approval: Approval<never>): ApprovalRule => ({
  group: approval === true ? null : (approval.group ?? null),
  conditional: approval !== true && typeof approval.when === "function",
});

// Every field approval, by the field's path; list items as "lines[].amount".
export const fieldApprovals = (root: Group) => {
  const rules: Array<ApprovalRule & { path: Path }> = [];
  const visit = (node: Field, path: Path) => {
    if (node.approval) rules.push({ path, ...approvalRule(node.approval) });
    for (const [name, value] of Object.entries(node.fields ?? {}))
      visit(value, child(path, name));
    if (node.item) visit(node.item, `${path}[]`);
  };
  visit(root, "");
  return rules;
};

export const serialise = (root: Group): SchemaManifest => {
  const node = (field: Field, inherited: Review | undefined): SchemaNode => {
    const review = field.review ?? inherited;
    const { options } = field;
    return {
      kind: field.kind,
      ...(field.description !== undefined && {
        description: field.description,
      }),
      ...(typeof review === "string" && { review }),
      ...(Array.isArray(options) && { options: normalise(options) }),
      ...(isSource(options) && {
        source: { search: true, get: true, page: Boolean(options.page) },
      }),
      ...(field.invalidates && { invalidates: [...field.invalidates] }),
      dynamic: {
        visible: typeof field.visible === "function",
        options: typeof options === "function",
        review: typeof review === "function",
        fetch: field.kind === "fetched",
      },
      ...(field.fields && {
        fields: Object.fromEntries(
          Object.entries(field.fields).map(([name, value]) => [
            name,
            node(value, review),
          ]),
        ),
      }),
      ...(field.item && { item: node(field.item, review) }),
    };
  };
  return {
    root: node(root, undefined),
    checks: Object.keys(root.checks ?? {}),
  };
};

class Pending extends Error {
  constructor(readonly promise: Promise<unknown>) {
    super("A fetched field is still loading");
  }
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const sha256 = async (text: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

type Settled<T> =
  | { ok: true; value: T; reads: Set<Path> }
  | { ok: false; error: string; reads: Set<Path> };

const settle = async <T>(
  fn: (reads: Set<Path>) => T | Promise<T>,
): Promise<Settled<T>> => {
  for (;;) {
    const reads = new Set<Path>();
    try {
      return { ok: true, value: await fn(reads), reads };
    } catch (error) {
      if (error instanceof Pending) {
        await error.promise;
        continue;
      }
      return { ok: false, error: message(error), reads };
    }
  }
};

type FetchState = {
  reads: Set<Path>;
  value?: unknown;
  fresh?: { key: string; data: unknown };
  error?: string;
};

const session = (
  root: Group,
  answers: Record<Path, unknown>,
  cached: EvaluateRequest["fetched"],
  ctx: FunctionContext,
) => {
  const counts = new Map<Path, number>();
  const count = (list: Path) => {
    let n = counts.get(list);
    if (n !== undefined) return n;
    n = 0;
    for (const key of Object.keys(answers)) {
      if (!key.startsWith(`${list}[`)) continue;
      const index = /^\[(\d+)\]/.exec(key.slice(list.length))?.[1];
      if (index !== undefined) n = Math.max(n, Number(index) + 1);
    }
    counts.set(list, n);
    return n;
  };

  const chainOf = (path: Path) => {
    try {
      return resolve(root, parsePath(path));
    } catch {
      return null;
    }
  };

  const visibility = new Map<
    Path,
    { visible: boolean; reads: Set<Path> } | { error: string }
  >();
  const evaluating = new Set<Path>();
  const ownVisible = (step: Step, reads: Set<Path>): boolean => {
    const fn = step.node.visible;
    if (!fn) return true;
    let memo = visibility.get(step.path);
    if (!memo) {
      if (evaluating.has(step.path))
        throw new Error(`Circular visibility at ${step.path}`);
      evaluating.add(step.path);
      const own = new Set<Path>();
      try {
        memo = {
          visible: Boolean(fn(accessor(own, step.path, []))),
          reads: own,
        };
      } catch (error) {
        if (error instanceof Pending) throw error;
        memo = { error: message(error) };
      } finally {
        evaluating.delete(step.path);
      }
      visibility.set(step.path, memo);
    }
    if ("error" in memo) throw new Error(memo.error);
    for (const read of memo.reads) reads.add(read);
    return memo.visible;
  };

  const isVisible = (chain: Step[], reads: Set<Path>) =>
    chain.slice(1).every((step) => ownVisible(step, reads));

  const fetches = new Map<Path, FetchState | Promise<FetchState>>();
  const resolveFetched = async (
    step: Step,
    stack: Path[],
  ): Promise<FetchState> => {
    const { node, path } = step;
    const inputs = await settle((reads) =>
      node.inputs!(accessor(reads, path, [...stack, path])),
    );
    if (!inputs.ok) return { reads: inputs.reads, error: inputs.error };
    const state: FetchState = { reads: inputs.reads };
    try {
      const key = await sha256(canonical(inputs.value));
      let data: unknown;
      if (cached[path]?.key === key) data = cached[path].data;
      else {
        data = (await node.fetch!(inputs.value, ctx)) ?? null;
        state.fresh = { key, data };
      }
      state.value = node.transform ? node.transform(data) : data;
    } catch (error) {
      state.error = message(error);
    }
    return state;
  };
  const fetched = (
    step: Step,
    stack: Path[],
  ): FetchState | Promise<FetchState> => {
    let state = fetches.get(step.path);
    if (!state) {
      state = resolveFetched(step, stack).then((settled) => {
        fetches.set(step.path, settled);
        return settled;
      });
      fetches.set(step.path, state);
    }
    return state;
  };

  const expand = (segments: Segment[], reads: Set<Path>): Path[] => {
    let paths: Path[] = [""];
    for (const segment of segments) {
      paths = paths.flatMap((path) => {
        if (segment !== ANY) return [child(path, segment)];
        reads.add(path);
        return Array.from({ length: count(path) }, (_, i) => child(path, i));
      });
    }
    return paths;
  };

  const accessor = (reads: Set<Path>, at: Path, stack: Path[]): Answers => {
    const get = (path: Path) => {
      reads.add(path);
      const chain = chainOf(path);
      if (chain && !isVisible(chain, reads)) return null;
      return answers[path] ?? null;
    };
    const all = (pattern: string) => expand(parsePath(pattern), reads).map(get);
    return {
      get,
      all,
      sum: (pattern) =>
        all(pattern).reduce<number>(
          (total, value) =>
            typeof value === "number" && Number.isFinite(value)
              ? total + value
              : total,
          0,
        ),
      sibling: (name) => {
        const segments = parsePath(at);
        const base =
          typeof segments[segments.length - 1] === "string"
            ? at.slice(0, Math.max(0, at.lastIndexOf(".")))
            : at;
        return get(child(base, name));
      },
      fetched: (path) => {
        reads.add(path);
        const chain = chainOf(path);
        const step = chain?.[chain.length - 1];
        if (!chain || step?.node.kind !== "fetched")
          throw new Error(`${path} is not a fetched field`);
        if (stack.includes(path)) throw new Error(`Circular fetch at ${path}`);
        if (!isVisible(chain, reads)) return null;
        const state = fetched(step, stack);
        if (state instanceof Promise) throw new Pending(state);
        return state.error === undefined ? (state.value ?? null) : null;
      },
    };
  };

  return { count, chainOf, isVisible, accessor, fetched };
};

const leaves = (
  node: Field,
  path: Path,
  count: (list: Path) => number,
): Path[] => {
  if (node.kind === "group")
    return Object.entries(node.fields ?? {}).flatMap(([name, value]) =>
      leaves(value, child(path, name), count),
    );
  if (node.kind === "list")
    return Array.from({ length: count(path) }, (_, i) =>
      leaves(node.item!, child(path, i), count),
    ).flat();
  return [path];
};

// The agent's approval before completion, when the code declared one.
export const evaluate = async (
  root: Group,
  request: EvaluateRequest,
  ctx: FunctionContext,
  completion?: Approval<Answers>,
): Promise<EvaluateResponse> => {
  const answers = request.answers ?? {};
  const run = session(root, answers, request.fetched ?? {}, ctx);

  const targets = new Set<Path>();
  for (const target of request.targets === "all" ? [""] : request.targets) {
    const chain = run.chainOf(target);
    if (!chain) targets.add(target);
    else
      for (const path of leaves(
        chain[chain.length - 1]!.node,
        target,
        run.count,
      ))
        targets.add(path);
  }

  const fields: Record<Path, FieldEval> = {};
  for (const path of targets) {
    const chain = run.chainOf(path);
    if (!chain) {
      fields[path] = {
        visible: false,
        review: "none",
        reads: [],
        error: `Unknown field ${path}`,
      };
      continue;
    }
    const step = chain[chain.length - 1]!;
    const { node } = step;
    const review = chain.reduce<Review | undefined>(
      (inherited, { node: n }) => n.review ?? inherited,
      undefined,
    );
    const result: FieldEval = { visible: true, review: "none", reads: [] };
    const reads = new Set<Path>();
    const track = async <T>(fn: (reads: Set<Path>) => T | Promise<T>) => {
      const settled = await settle(fn);
      for (const read of settled.reads) reads.add(read);
      if (!settled.ok) throw new Error(settled.error);
      return settled.value;
    };
    try {
      result.visible = await track((r) => run.isVisible(chain, r));
      if (typeof review === "string") result.review = review;
      if (result.visible) {
        if (typeof review === "function")
          result.review = await track((r) => review(run.accessor(r, path, [])));
        // The nearest approval on the field or a group or list holding it.
        // A `when` that throws counts as applying: approvals fail closed.
        for (const holder of [...chain].reverse()) {
          const approval = holder.node.approval;
          if (!approval) continue;
          const { group } = approvalRule(approval);
          const when = approval === true ? undefined : approval.when;
          if (!when) {
            result.approval = { group };
            break;
          }
          let applies = true;
          try {
            applies = Boolean(
              await track((r) => when(run.accessor(r, holder.path, []))),
            );
          } finally {
            if (applies) result.approval = { group };
          }
          if (applies) break;
        }
        const { options } = node;
        if (Array.isArray(options))
          result.options = { kind: "inline", items: normalise(options) };
        else if (typeof options === "function")
          result.options = {
            kind: "inline",
            items: normalise(
              await track((r) => options(run.accessor(r, path, []))),
            ),
          };
        else if (isSource(options)) result.options = { kind: "source" };
        if (node.kind === "fetched") {
          const state = await run.fetched(step, []);
          for (const read of state.reads) reads.add(read);
          if (state.error !== undefined) throw new Error(state.error);
          if (state.fresh) result.fetch = state.fresh;
          result.value = state.value ?? null;
        }
      }
    } catch (error) {
      result.error = message(error);
    }
    result.reads = [...reads].sort();
    fields[path] = result;
  }

  const checks: CheckResult[] = [];
  for (const [name, check] of Object.entries(root.checks ?? {})) {
    const settled = await settle((r) => check(run.accessor(r, "", [])));
    if (!settled.ok) checks.push({ name, ok: false, message: settled.error });
    else if (settled.value === true) checks.push({ name, ok: true });
    else if (typeof settled.value === "string")
      checks.push({ name, ok: false, message: settled.value });
    else if (settled.value && typeof settled.value === "object")
      checks.push({
        name,
        ok: false,
        field: settled.value.field,
        message: settled.value.message,
      });
    else checks.push({ name, ok: false });
  }

  let success: EvaluateResponse["success"];
  if (root.success) {
    const condition = root.success;
    const confirmed = new Set(request.confirmed ?? []);
    const unreviewed = new Set(request.unreviewed ?? []);
    for (const [path, f] of Object.entries(fields))
      if (f.visible && f.review === "required" && !confirmed.has(path))
        unreviewed.add(path);
      else unreviewed.delete(path);
    const settled = await settle((r) =>
      condition({
        ...run.accessor(r, "", []),
        allReviewed: () => unreviewed.size === 0,
      }),
    );
    success = !settled.ok
      ? { ok: false, message: settled.error }
      : settled.value === true
        ? { ok: true }
        : typeof settled.value === "string"
          ? { ok: false, message: settled.value }
          : { ok: false };
  }

  let approval: EvaluateResponse["approval"];
  if (completion) {
    const { group } = approvalRule(completion);
    const when = completion === true ? undefined : completion.when;
    const settled = when
      ? await settle((r) => when(run.accessor(r, "", [])))
      : { ok: true as const, value: true };
    if (!settled.ok || settled.value) approval = { group };
  }

  return {
    fields,
    checks,
    ...(success && { success }),
    ...(approval && { approval }),
  };
};

const page = (result: SourceResult): OptionsResponse => {
  if (Array.isArray(result)) return { items: normalise(result) };
  return {
    items: normalise(result.items),
    ...(result.cursor !== undefined && { cursor: result.cursor }),
    ...(result.total !== undefined && { total: result.total }),
  };
};

export class OptionsError extends Error {}

export const options = async (
  root: Group,
  request: OptionsRequest,
  ctx: FunctionContext,
): Promise<OptionsResponse> => {
  const run = session(root, request.answers ?? {}, {}, ctx);
  const chain = run.chainOf(request.path);
  const node = chain?.[chain.length - 1]?.node;
  if (!node || (node.kind !== "select" && node.kind !== "multiselect"))
    throw new OptionsError(
      `${request.path} is not a select or multiselect field`,
    );
  const requested = Number(request.limit);
  const limit =
    Number.isInteger(requested) && requested > 0
      ? Math.min(requested, 200)
      : 20;
  const source = node.options;

  const call = async <T>(fn: (a: Answers) => T | Promise<T>) => {
    const settled = await settle((reads) =>
      fn(run.accessor(reads, request.path, [])),
    );
    if (!settled.ok) throw new Error(settled.error);
    return settled.value;
  };

  if (isSource(source)) {
    if (request.ids)
      return page(await call((a) => source.get(request.ids!, { ...ctx, a })));
    const query = {
      ...ctx,
      limit,
      ...(request.cursor !== undefined && { cursor: request.cursor }),
    };
    if (request.query !== undefined || !source.page)
      return page(
        await call((a) => source.search(request.query ?? "", { ...query, a })),
      );
    const next = source.page;
    return page(await call((a) => next({ ...query, a })));
  }

  let items = normalise(
    typeof source === "function" ? await call(source) : (source ?? []),
  );
  if (request.ids)
    return { items: items.filter((item) => request.ids!.includes(item.id)) };
  const q = request.query?.trim().toLowerCase();
  if (q)
    items = items.filter((item) =>
      [item.id, item.label, item.description ?? ""].some((text) =>
        text.toLowerCase().includes(q),
      ),
    );
  const offset = Math.max(0, Number.parseInt(request.cursor ?? "0", 10) || 0);
  const end = offset + limit;
  return {
    items: items.slice(offset, end),
    ...(end < items.length && { cursor: String(end) }),
    total: items.length,
  };
};
