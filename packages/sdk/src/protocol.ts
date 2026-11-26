// The contract between the Preprocess runtime and an agent's deployed Worker.
// The runtime reads GET /manifest once per case and calls POST /tools/:name
// for every tool call. Both sides import these types; the protocol number
// changes only on a breaking change, and the runtime supports every protocol
// within an SDK major version (spec 16d).

export const PROTOCOL = 1;

// The base models an agent runs on (spec 3), every call billed per token.
// `serving` is who serves the untrained model: Baseten's per-token Model APIs
// or Cloudflare Workers AI. `trainable` stays false while training is Coming
// soon (spec 12a). The fast variant of DeepSeek V4.1 Flash is the same model
// on Baseten's Fast capacity.
export const MODEL_CATALOG = {
  "kimi-k3.1-pro": {
    label: "Kimi K3.1 Pro",
    serving: "baseten",
    trainable: false,
  },
  "deepseek-v4.1-flash": {
    label: "DeepSeek V4.1 Flash",
    serving: "baseten",
    trainable: false,
  },
  "deepseek-v4.1-flash-fast": {
    label: "DeepSeek V4.1 Flash (fast)",
    serving: "baseten",
    trainable: false,
  },
  "qwen3.8-27b": {
    label: "Qwen 3.8 27B",
    serving: "workers-ai",
    trainable: false,
  },
} as const satisfies Record<
  string,
  { label: string; serving: "baseten" | "workers-ai"; trainable: boolean }
>;
export type Model = keyof typeof MODEL_CATALOG;
export const MODELS = Object.keys(MODEL_CATALOG) as [Model, ...Model[]];

export const DEFAULT_MODEL: Model = "deepseek-v4.1-flash";

// Models spec 1.5 retired, which deployments built with an older SDK still
// name, and the model each now runs on.
export const RETIRED_MODELS: Readonly<Record<string, Model>> = {
  "inkling-2-mini": "deepseek-v4.1-flash",
  "inkling-2-small": "deepseek-v4.1-flash",
};

export const currentModel = (model: string): string =>
  RETIRED_MODELS[model] ?? model;

export const REASONING = ["low", "medium", "high"] as const;
export type Reasoning = (typeof REASONING)[number];

// Binding names the platform sets on every deployment; secrets cannot use them.
export const RESERVED_BINDINGS = ["MCP", "MODELS"] as const;
export const RESERVED_PREFIX = "PREPROCESS_";
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

export type ToolManifest = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  sideEffects: boolean;
};

type ManifestV1 = {
  protocol: typeof PROTOCOL;
  sdk: { name: "@preprocess/sdk"; version: string };
  instructions: string;
  model: Model;
  reasoning: Reasoning;
  secrets: string[];
  mcp: string[];
  tools: ToolManifest[];
};

export type ToolCall = {
  input: unknown;
  case: { id: string };
  callId: string;
  // Set when a person approved this exact call after an approval effect.
  approved?: true;
};

export type ToolResult = {
  output: unknown;
  isError: boolean;
  /** The tool's code threw, as opposed to refusing its input: retryable. */
  threw?: true;
  effects?: Effect[];
};

// The platform's MCP token service, bound to every deployment as `MCP` with
// the organization, agent and deployment fixed in its props. Customer code
// never sees a connection token.
export type McpBinding = {
  listTools(
    server: string,
  ): Promise<
    Array<{ name: string; description?: string; inputSchema: unknown }>
  >;
  call(
    server: string,
    tool: string,
    args: unknown,
    opts: { caseId: string },
  ): Promise<unknown>;
};

// ---------------------------------------------------------------------------
// Schema engine (design doc 05). Additive to protocol 1: a manifest without
// `schema` is an agent with no output schema, and the runtime treats a
// missing field as empty.

// Dotted, with list indices: "vendor", "lines[2].glAccount".
export type Path = string;

export type FieldKind =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "select"
  | "multiselect"
  | "group"
  | "list"
  | "fetched";

export type SchemaOption = {
  id: string;
  label: string;
  description?: string;
  data?: unknown;
};

export type ReviewRequirement = "required" | "none";

// The static tree, serialised into the manifest. The functions stay in the
// agent's Worker; `dynamic` says which parts need /schema/evaluate.
export type SchemaNode = {
  kind: FieldKind;
  description?: string;
  // Static review requirement; dynamic when dynamic.review is true.
  review?: ReviewRequirement;
  // Inline options known without evaluation (select, multiselect).
  options?: SchemaOption[];
  // select or multiselect whose options come from s.source(): searched and
  // paged through /schema/options, never sent whole.
  source?: { search: boolean; get: boolean; page: boolean };
  invalidates?: Path[];
  dynamic: {
    visible: boolean;
    options: boolean;
    review: boolean;
    fetch: boolean;
  };
  // group: its fields in order; list: the item shape.
  fields?: Record<string, SchemaNode>;
  item?: SchemaNode;
};

export type SchemaManifest = {
  root: SchemaNode;
  checks: string[];
};

// Schedules are declared in code and listed and paused through the API
// (design doc 04).
export type Schedule = {
  name: string;
  cron: string;
  timezone: string;
  text: string;
  previews: boolean;
};

export type Manifest = ManifestV1 & {
  schema?: SchemaManifest;
  // Group slugs the code waits on or tags; checked at deploy (doc 06).
  groups?: string[];
  schedules?: Schedule[];
  // OCR every uploaded file before the run (doc 04).
  ocr?: boolean;
  // Hosts the code may reach, in the outbound Worker's pattern syntax.
  network?: string[];
  timeoutSeconds?: number;
  toolRetries?: number;
  sandboxImage?: string;
  evals?: { onPush?: boolean };
  approvals?: Approvals;
  // The setting keys the code or preprocess.config.json set; every other
  // setting is the SDK's default (model, reasoning) or unset.
  declared?: string[];
  // Build warnings: an inline value preprocess.config.json overrides, or a
  // group its groups list leaves out.
  warnings?: string[];
};

// preprocess.config.json beside the agent: settings that win over the
// inline ones, and the organization's groups (`preprocess config pull`,
// `preprocess groups pull`). bundle() injects it as __PREPROCESS_CONFIG__.
export type ProjectSettings = {
  model?: Model;
  reasoning?: Reasoning;
  ocr?: boolean;
  network?: string[];
  timeoutSeconds?: number;
  toolRetries?: number;
  sandboxImage?: string;
  evals?: { onPush?: boolean };
  schedules?: Record<string, { previews?: boolean }>;
};

export type ProjectConfig = {
  settings?: ProjectSettings;
  groups?: { slug: string; name: string; description?: string }[];
};

// POST /schema/evaluate (runtime → agent Worker)
export type EvaluateRequest = {
  caseId: string;
  answers: Record<Path, unknown>;
  fetched: Record<Path, { key: string; data: unknown }>;
  targets: Path[] | "all";
  // For allReviewed(): paths whose answer a person confirmed, and fields
  // outside the targets that still wait for review as of the last evaluation.
  confirmed?: Path[];
  unreviewed?: Path[];
};

export type FieldEval = {
  visible: boolean;
  // Set when the field is visible and an approval covering it applies.
  approval?: { group: string | null };
  options?:
    | { kind: "inline"; items: SchemaOption[] }
    | { kind: "source"; count?: number };
  review: ReviewRequirement;
  // Every path read while evaluating this field (a.get, a.fetched, a.sum).
  reads: Path[];
  fetch?: { key: string; data: unknown };
  value?: unknown;
  error?: string;
};

export type CheckResult = {
  name: string;
  ok: boolean;
  field?: Path;
  message?: string;
};

export type EvaluateResponse = {
  fields: Record<Path, FieldEval>;
  checks: CheckResult[];
  // The schema's success condition, when it declares one: the case completes
  // only while every check passes and this is ok.
  success?: { ok: boolean; message?: string };
  // Set when the agent's approval before completion applies.
  approval?: { group: string | null };
};

// POST /schema/options (search and paging on a source)
export type OptionsRequest = {
  caseId: string;
  path: Path;
  answers: Record<Path, unknown>;
  query?: string;
  cursor?: string;
  ids?: string[];
  limit: number;
};

export type OptionsResponse = {
  items: SchemaOption[];
  cursor?: string;
  total?: number;
};

// What a tool asks the platform to do besides returning output (doc 06).
// Code names groups by slug, never people.
export type Effect =
  | { type: "wait"; group: string; reason: string | null }
  | { type: "tag"; group: string; message: string }
  // The tool did not run: a person must approve the call first. The runtime
  // re-sends the identical call with approved: true once one does.
  | { type: "approval"; group: string | null; reason: string | null };

// ---------------------------------------------------------------------------
// Approvals (step 4). Additive to protocol 1. A null group is any operator.
// `conditional` is true when the code's `when` decides per case, call or
// answers; the runtime then asks the agent's Worker (/schema/evaluate for the
// agent and fields, the tool call itself for tools).
export type ApprovalRule = { group: string | null; conditional: boolean };

export type Approvals = {
  // Every group an approval names, for the deployment's approving groups.
  groups: string[];
  // Approval before the case completes.
  agent: ApprovalRule | null;
  // Schema fields by path; list items are written "lines[].amount". A rule
  // on a group or list covers its whole subtree and is not inherited.
  fields: Array<ApprovalRule & { path: Path }>;
  // Approval before each call of the tool.
  tools: Array<ApprovalRule & { name: string }>;
};
