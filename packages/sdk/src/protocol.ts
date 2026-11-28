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

// An organization's own model (design doc 10), registered by endpoint, such as
// a trained checkpoint: "org:<slug>". MODEL_CATALOG stays the built-in list.
export const ORG_MODEL = /^org:[a-z0-9][a-z0-9-]{0,62}$/;
export type OrgModel = `org:${string}`;
export const isOrgModel = (id: string): id is OrgModel => ORG_MODEL.test(id);

// What an agent names as its model: a catalogue model or an organization's.
export type ModelId = Model | OrgModel;

export const REASONING = ["low", "medium", "high"] as const;
export type Reasoning = (typeof REASONING)[number];

// Binding names the platform sets on every deployment; secrets cannot use them.
export const RESERVED_BINDINGS = ["MCP", "MODELS"] as const;
export const RESERVED_PREFIX = "PREPROCESS_";
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

// Case sandboxes (spec 3): a Linux container an agent's case can run code in.
// Opt-in, and the size is required. Each size is one Cloudflare instance type,
// fixed for the life of the sandbox.
export const SANDBOX_SIZES = ["small", "medium", "large"] as const;
export type SandboxSize = (typeof SANDBOX_SIZES)[number];

// Images the platform builds; an agent picks one. "standard" is the base every
// preset is built on.
export const SANDBOX_PRESETS = [
  "standard",
  "node",
  "python",
  "python-data",
] as const;
export type SandboxPreset = (typeof SANDBOX_PRESETS)[number];

export const SANDBOX_IDLE_MINUTES = { default: 5, max: 60 } as const;

// Package names install with argv, never a shell; a leading dash is refused
// so a name cannot pass a flag.
export const SANDBOX_PACKAGE = {
  apt: /^[a-z0-9][a-z0-9+.-]{0,99}(=[A-Za-z0-9.:~+-]{1,64})?$/,
  pip: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(\[[A-Za-z0-9,._-]{1,64}\])?((==|>=|<=|~=|!=|<|>)[A-Za-z0-9.*+!-]{1,64})?$/,
  npm: /^(@[a-z0-9~][a-z0-9._~-]{0,99}\/)?[a-z0-9~][a-z0-9._~-]{0,99}(@[A-Za-z0-9.^~*+-]{1,64})?$/,
} as const;
export const SANDBOX_PACKAGE_LIMIT = 50;

export type SandboxPackages = { apt: string[]; pip: string[]; npm: string[] };

// A custom environment (spec 3): build steps over the preset, run once at
// deploy and captured as a layer the sandbox mounts at every start, so a
// start does not reinstall them. Run commands run as root in /workspace.
export type SandboxSetup = {
  packages: SandboxPackages;
  run: string[];
  files: Record<string, string>;
  env: Record<string, string>;
};

export const SANDBOX_SETUP_LIMITS = {
  run: 50,
  runChars: 4_000,
  files: 100,
  fileBytes: 1_000_000,
  env: 50,
  envChars: 4_000,
} as const;

export const SANDBOX_ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
const RESERVED_SANDBOX_ENV = ["HOME", "USER"];
const RESERVED_SANDBOX_PATHS = [
  "/proc",
  "/sys",
  "/dev",
  "/tmp",
  "/run",
  "/.preprocess",
];

export type SandboxManifest = {
  size: SandboxSize;
  preset: SandboxPreset;
  packages: SandboxPackages;
  idleTimeoutMinutes: number;
  setup?: SandboxSetup;
};

// What is wrong with a package list, in words a deploy prints.
const packageProblems = (
  where: string,
  packages: unknown,
  preset: string,
): string[] => {
  if (packages === undefined) return [];
  if (typeof packages !== "object" || packages === null)
    return [`${where} must be an object of apt, pip and npm lists`];
  const problems: string[] = [];
  for (const [kind, list] of Object.entries(packages)) {
    if (!(kind in SANDBOX_PACKAGE)) {
      problems.push(`${where}.${kind} is not apt, pip or npm`);
      continue;
    }
    if (!Array.isArray(list)) {
      problems.push(`${where}.${kind} must be a list of names`);
      continue;
    }
    if (list.length > SANDBOX_PACKAGE_LIMIT)
      problems.push(
        `${where}.${kind} lists more than ${SANDBOX_PACKAGE_LIMIT} packages`,
      );
    const pattern = SANDBOX_PACKAGE[kind as keyof SandboxPackages];
    for (const name of list)
      if (typeof name !== "string" || !pattern.test(name))
        problems.push(
          `${where}.${kind} has an invalid package ${JSON.stringify(name)}`,
        );
  }
  const listed = (kind: string) =>
    ((packages as Record<string, unknown[]>)[kind]?.length ?? 0) > 0;
  if (listed("pip") && !preset.startsWith("python"))
    problems.push(`${where}.pip needs the "python" or "python-data" preset`);
  if (listed("npm") && preset !== "node")
    problems.push(`${where}.npm needs the "node" preset`);
  return problems;
};

const record = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The absolute path a setup file is written to: relative paths are under
// /workspace.
export const sandboxFilePath = (path: string) =>
  path.startsWith("/") ? path : `/workspace/${path}`;

const setupProblems = (setup: unknown, preset: string): string[] => {
  if (!record(setup))
    return ["sandbox.setup must be an object of packages, run, files and env"];
  const s = setup as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(s))
    if (!["packages", "run", "files", "env"].includes(key))
      problems.push(`sandbox.setup.${key} is not packages, run, files or env`);
  problems.push(
    ...packageProblems("sandbox.setup.packages", s.packages, preset),
  );
  const L = SANDBOX_SETUP_LIMITS;
  if (s.run !== undefined) {
    if (!Array.isArray(s.run) || s.run.some((c) => typeof c !== "string"))
      problems.push("sandbox.setup.run must be a list of shell commands");
    else {
      if (s.run.length > L.run)
        problems.push(`sandbox.setup.run lists more than ${L.run} commands`);
      if ((s.run as string[]).some((c) => !c.trim() || c.length > L.runChars))
        problems.push(
          `each sandbox.setup.run command must be 1 to ${L.runChars} characters`,
        );
    }
  }
  if (s.files !== undefined) {
    if (!record(s.files))
      problems.push("sandbox.setup.files must map paths to text contents");
    else {
      const entries = Object.entries(s.files as Record<string, unknown>);
      if (entries.length > L.files)
        problems.push(`sandbox.setup.files lists more than ${L.files} files`);
      let bytes = 0;
      for (const [path, content] of entries) {
        if (typeof content !== "string") {
          problems.push(`sandbox.setup.files["${path}"] must be text`);
          continue;
        }
        bytes += new TextEncoder().encode(content).byteLength;
        const full = sandboxFilePath(path);
        if (
          !path ||
          path.split("/").some((part) => part === "..") ||
          full.endsWith("/") ||
          RESERVED_SANDBOX_PATHS.some(
            (r) => full === r || full.startsWith(`${r}/`),
          )
        )
          problems.push(
            `sandbox.setup.files has a path it cannot write: ${JSON.stringify(path)}`,
          );
      }
      if (bytes > L.fileBytes)
        problems.push(
          `sandbox.setup.files holds more than ${L.fileBytes / 1_000_000} MB`,
        );
    }
  }
  if (s.env !== undefined) {
    if (!record(s.env))
      problems.push("sandbox.setup.env must map names to text values");
    else {
      const entries = Object.entries(s.env as Record<string, unknown>);
      if (entries.length > L.env)
        problems.push(`sandbox.setup.env lists more than ${L.env} variables`);
      for (const [name, value] of entries) {
        if (
          !SANDBOX_ENV_NAME.test(name) ||
          RESERVED_SANDBOX_ENV.includes(name) ||
          name.startsWith(RESERVED_PREFIX)
        )
          problems.push(
            `sandbox.setup.env has a name it cannot set: ${JSON.stringify(name)}`,
          );
        if (typeof value !== "string" || value.length > L.envChars)
          problems.push(
            `sandbox.setup.env.${name} must be text of at most ${L.envChars} characters`,
          );
      }
    }
  }
  return problems;
};

// What is wrong with an agent's sandbox setting, in words a deploy prints.
// The SDK checks it when the agent is built and the platform again at deploy,
// for manifests another bundler or an older SDK produced.
export const sandboxProblems = (sandbox: unknown): string[] => {
  if (typeof sandbox !== "object" || sandbox === null || Array.isArray(sandbox))
    return [`sandbox must be an object like { size: "small" }`];
  const s = sandbox as Record<string, unknown>;
  const problems: string[] = [];
  if (s.size === undefined)
    problems.push(
      `sandbox.size is required: pick one of ${SANDBOX_SIZES.join(", ")}`,
    );
  else if (!(SANDBOX_SIZES as readonly unknown[]).includes(s.size))
    problems.push(`sandbox.size must be one of ${SANDBOX_SIZES.join(", ")}`);
  if (
    s.preset !== undefined &&
    !(SANDBOX_PRESETS as readonly unknown[]).includes(s.preset)
  )
    problems.push(
      `sandbox.preset must be one of ${SANDBOX_PRESETS.join(", ")}`,
    );
  const idle = s.idleTimeoutMinutes;
  if (
    idle !== undefined &&
    !(
      typeof idle === "number" &&
      Number.isInteger(idle) &&
      idle >= 1 &&
      idle <= SANDBOX_IDLE_MINUTES.max
    )
  )
    problems.push(
      `sandbox.idleTimeoutMinutes must be a whole number from 1 to ${SANDBOX_IDLE_MINUTES.max}`,
    );
  const preset = typeof s.preset === "string" ? s.preset : "standard";
  problems.push(...packageProblems("sandbox.packages", s.packages, preset));
  if (s.setup !== undefined) problems.push(...setupProblems(s.setup, preset));
  return problems;
};

// The manifest's form of a valid sandbox setting, with defaults filled in.
export const sandboxManifest = (sandbox: {
  size: SandboxSize;
  preset?: SandboxPreset;
  packages?: Partial<SandboxPackages>;
  idleTimeoutMinutes?: number;
  setup?: {
    packages?: Partial<SandboxPackages>;
    run?: string[];
    files?: Record<string, string>;
    env?: Record<string, string>;
  };
}): SandboxManifest => ({
  size: sandbox.size,
  preset: sandbox.preset ?? "standard",
  packages: {
    apt: [...(sandbox.packages?.apt ?? [])],
    pip: [...(sandbox.packages?.pip ?? [])],
    npm: [...(sandbox.packages?.npm ?? [])],
  },
  idleTimeoutMinutes:
    sandbox.idleTimeoutMinutes ?? SANDBOX_IDLE_MINUTES.default,
  ...(sandbox.setup && {
    setup: {
      packages: {
        apt: [...(sandbox.setup.packages?.apt ?? [])],
        pip: [...(sandbox.setup.packages?.pip ?? [])],
        npm: [...(sandbox.setup.packages?.npm ?? [])],
      },
      run: [...(sandbox.setup.run ?? [])],
      files: { ...sandbox.setup.files },
      env: { ...sandbox.setup.env },
    },
  }),
});

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
  model: ModelId;
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
  // The search_cases tool over the agent's completed cases (spec 10).
  searchCases?: boolean;
  // Hosts the code may reach, in the outbound Worker's pattern syntax.
  network?: string[];
  timeoutSeconds?: number;
  toolRetries?: number;
  sandboxImage?: string;
  sandbox?: SandboxManifest;
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
  model?: ModelId;
  reasoning?: Reasoning;
  ocr?: boolean;
  searchCases?: boolean;
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
