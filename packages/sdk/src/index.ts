import { z } from "zod";

import {
  DEFAULT_MODEL,
  MODELS,
  PROTOCOL,
  REASONING,
  RESERVED_BINDINGS,
  RESERVED_PREFIX,
  sandboxManifest,
  sandboxProblems,
  SECRET_NAME,
  type Approvals,
  type Effect,
  type EvaluateRequest,
  type Manifest,
  type McpBinding,
  type Model,
  type OptionsRequest,
  type ProjectConfig,
  type ProjectSettings,
  type Reasoning,
  type SandboxPackages,
  type SandboxPreset,
  type SandboxSize,
  type Schedule,
  type ToolCall,
  type ToolResult,
} from "./protocol.ts";
import { redact, redactConsole, redactText, type Secrets } from "./redact.ts";
import {
  approvalRule,
  evaluate,
  fieldApprovals,
  options,
  OptionsError,
  schemaProblems,
  serialise,
  type Answers,
  type Approval,
  type Field,
  type Group,
} from "./schema.ts";

export type {
  Manifest,
  Model,
  ProjectConfig,
  ProjectSettings,
  Reasoning,
  SandboxPackages,
  SandboxPreset,
  SandboxSize,
} from "./protocol.ts";
export { SANDBOX_PRESETS, SANDBOX_SIZES } from "./protocol.ts";
export { allReviewed, schema } from "./schema.ts";
export type {
  Answers,
  Approval,
  Check,
  Field,
  FieldOptions,
  FunctionContext,
  Group,
  Review,
  Source,
  SourceResult,
  Success,
} from "./schema.ts";

export const SDK_VERSION = "0.1.0";

export type McpServer = {
  listTools(): ReturnType<McpBinding["listTools"]>;
  call(tool: string, args?: Record<string, unknown>): Promise<unknown>;
};

export type ToolContext<S extends string> = {
  // Only the secrets the agent declared and the organization granted; a
  // declared secret without a grant is undefined.
  env: Readonly<Record<S, string | undefined>>;
  case: { id: string };
  mcp(server: string): McpServer;
  // Group slugs must be listed in the agent's groups.
  waitOn(group: string, opts?: { reason?: string }): void;
  tag(group: string, message: string): void;
};

export type Tool<S extends string = string> = {
  description: string;
  input: z.ZodType;
  sideEffects: boolean;
  approval?: Approval<unknown>;
  run(input: unknown, ctx: ToolContext<S>): unknown;
};

export const tool = <
  I extends z.ZodType,
  S extends string = string,
>(definition: {
  description: string;
  input: I;
  // A tool that changes something outside the case (sends, pays, writes).
  sideEffects?: boolean;
  // A person approves each call first; `when` sees the call's input.
  approval?: Approval<z.output<I>>;
  run(input: z.output<I>, ctx: ToolContext<S>): unknown;
}): Tool<S> => ({
  description: definition.description,
  input: definition.input,
  sideEffects: definition.sideEffects ?? false,
  ...(definition.approval !== undefined && {
    approval: definition.approval as Approval<unknown>,
  }),
  run: (input, ctx) => definition.run(input as z.output<I>, ctx),
});

export type AgentDefinition<S extends string> = {
  instructions: string;
  model?: Model;
  reasoning?: Reasoning;
  secrets?: readonly S[];
  mcp?: readonly string[];
  tools: Record<string, Tool<NoInfer<S>>>;
  schema?: Group;
  groups?: readonly string[];
  schedules?: readonly ScheduleDefinition[];
  ocr?: boolean;
  // Give the agent the search_cases tool over its own completed cases in the
  // same environment. Off unless set.
  searchCases?: boolean;
  // Hosts the code may reach, in the outbound Worker's pattern syntax.
  network?: readonly string[];
  timeoutSeconds?: number;
  toolRetries?: number;
  sandboxImage?: string;
  // A Linux sandbox the case can run commands in, started on first use. The
  // size is required; the preset defaults to "standard" and the packages
  // install each time the sandbox starts.
  sandbox?: {
    size: SandboxSize;
    preset?: SandboxPreset;
    packages?: Partial<SandboxPackages>;
    idleTimeoutMinutes?: number;
  };
  evals?: { onPush?: boolean };
  // A person approves the case before it completes; `when` sees the final
  // answers and needs a schema.
  approval?: Approval<Answers>;
};

export type ScheduleDefinition = Omit<Schedule, "timezone" | "previews"> & {
  timezone?: string;
  previews?: boolean;
};

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const GROUP_SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SCHEDULE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CRON_FIELD = /^[0-9A-Za-z*?/,#-]+$/;

const validTimezone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

const check = (definition: AgentDefinition<string>) => {
  const problems: string[] = [];
  if (!definition.instructions.trim()) problems.push("instructions are empty");
  if (definition.model && !MODELS.includes(definition.model))
    problems.push(`model must be one of ${MODELS.join(", ")}`);
  if (definition.reasoning && !REASONING.includes(definition.reasoning))
    problems.push(`reasoning must be one of ${REASONING.join(", ")}`);
  for (const name of definition.secrets ?? []) {
    if (!SECRET_NAME.test(name))
      problems.push(`secret ${name} must match ${SECRET_NAME}`);
    if (
      (RESERVED_BINDINGS as readonly string[]).includes(name) ||
      name.startsWith(RESERVED_PREFIX)
    )
      problems.push(`secret ${name} uses a reserved binding name`);
  }
  for (const name of Object.keys(definition.tools)) {
    if (!TOOL_NAME.test(name))
      problems.push(`tool ${name} must match ${TOOL_NAME}`);
  }
  if (definition.schema !== undefined)
    problems.push(...schemaProblems(definition.schema));
  const groups = definition.groups ?? [];
  for (const slug of groups)
    if (!GROUP_SLUG.test(slug))
      problems.push(`group ${slug} must match ${GROUP_SLUG}`);
  if (new Set(groups).size !== groups.length)
    problems.push("groups must be unique");
  const names = new Set<string>();
  for (const schedule of definition.schedules ?? []) {
    if (!SCHEDULE_NAME.test(schedule.name))
      problems.push(`schedule ${schedule.name} must match ${SCHEDULE_NAME}`);
    if (names.has(schedule.name))
      problems.push(`schedule ${schedule.name} is declared twice`);
    names.add(schedule.name);
    const fields = schedule.cron.trim().split(/\s+/);
    if (fields.length !== 5 || !fields.every((f) => CRON_FIELD.test(f)))
      problems.push(
        `schedule ${schedule.name} needs a 5-field cron expression`,
      );
    if (schedule.timezone !== undefined && !validTimezone(schedule.timezone))
      problems.push(`schedule ${schedule.name} has an unknown timezone`);
    if (!schedule.text.trim())
      problems.push(`schedule ${schedule.name} has empty text`);
  }
  for (const host of definition.network ?? [])
    if (!host.trim()) problems.push("network hosts must not be empty");
  if (
    definition.timeoutSeconds !== undefined &&
    !(
      Number.isInteger(definition.timeoutSeconds) &&
      definition.timeoutSeconds > 0
    )
  )
    problems.push("timeoutSeconds must be a positive integer");
  if (
    definition.toolRetries !== undefined &&
    !(Number.isInteger(definition.toolRetries) && definition.toolRetries >= 0)
  )
    problems.push("toolRetries must be a whole number");
  if (definition.sandboxImage !== undefined && !definition.sandboxImage.trim())
    problems.push("sandboxImage must not be empty");
  if (definition.sandbox !== undefined)
    problems.push(...sandboxProblems(definition.sandbox));
  if (!problems.length) problems.push(...approvalProblems(definition));
  if (problems.length) throw new Error(`Invalid agent: ${problems.join("; ")}`);
};

const approvalShapeOk = (approval: unknown) =>
  approval === true ||
  (typeof approval === "object" &&
    approval !== null &&
    ((approval as { group?: unknown }).group === undefined ||
      typeof (approval as { group?: unknown }).group === "string") &&
    ((approval as { when?: unknown }).when === undefined ||
      typeof (approval as { when?: unknown }).when === "function"));

const approvalsOf = (
  definition: AgentDefinition<string>,
): Approvals | undefined => {
  const agent =
    definition.approval === undefined
      ? null
      : approvalRule(definition.approval);
  const fields = definition.schema ? fieldApprovals(definition.schema) : [];
  const tools = Object.entries(definition.tools).flatMap(([name, t]) =>
    t.approval === undefined
      ? []
      : [{ name, ...approvalRule(t.approval as Approval<never>) }],
  );
  if (!agent && !fields.length && !tools.length) return undefined;
  const groups = [agent, ...fields, ...tools].flatMap((rule) =>
    rule?.group ? [rule.group] : [],
  );
  return { groups: [...new Set(groups)].sort(), agent, fields, tools };
};

const approvalProblems = (definition: AgentDefinition<string>) => {
  const problems: string[] = [];
  const shapes: Array<[string, unknown]> = [
    ["approval", definition.approval],
    ...Object.entries(definition.tools).map(([name, t]): [string, unknown] => [
      `tool ${name} approval`,
      t.approval,
    ]),
  ];
  const visit = (node: Record<string, Field> | undefined, path: string) => {
    for (const [name, value] of Object.entries(node ?? {})) {
      const here = path ? `${path}.${name}` : name;
      shapes.push([`field ${here} approval`, value.approval]);
      visit(value.fields, here);
      if (value.item) {
        shapes.push([`field ${here}[] approval`, value.item.approval]);
        visit(value.item.fields, `${here}[]`);
      }
    }
  };
  if (definition.schema) {
    shapes.push(["schema approval", definition.schema.approval]);
    visit(definition.schema.fields, "");
  }
  for (const [label, approval] of shapes)
    if (approval !== undefined && !approvalShapeOk(approval))
      problems.push(
        `${label} must be true or { group?: string, when?: function }`,
      );
  if (problems.length) return problems;
  const approvals = approvalsOf(definition);
  if (!approvals) return problems;
  for (const group of approvals.groups)
    if (!(definition.groups ?? []).includes(group))
      problems.push(
        `approval group ${group} is not declared in this agent's groups list`,
      );
  if (approvals.agent?.conditional && !definition.schema)
    problems.push("approval.when needs a schema: it reads the final answers");
  return problems;
};

// Set by bundle() from preprocess.config.json; absent when another bundler
// built the agent.
declare const __PREPROCESS_CONFIG__: ProjectConfig | undefined;

const SETTINGS = [
  "model",
  "reasoning",
  "ocr",
  "searchCases",
  "network",
  "timeoutSeconds",
  "toolRetries",
  "sandboxImage",
  "evals",
] as const satisfies readonly (keyof ProjectSettings &
  keyof AgentDefinition<string>)[];

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const differs = (key: string, inline: unknown, file: unknown) =>
  `${key} is ${JSON.stringify(inline)} in code but ${JSON.stringify(file)} in preprocess.config.json, which wins`;

// The file's settings win over the inline ones. `declared` names every
// setting either of them set, so a settings page can tell them from defaults.
const settle = <S extends string>(
  definition: AgentDefinition<S>,
  config: ProjectConfig,
) => {
  const file = config.settings ?? {};
  const merged: AgentDefinition<S> = { ...definition };
  const declared: string[] = [];
  const warnings: string[] = [];
  for (const key of SETTINGS) {
    const inline = definition[key];
    if (file[key] !== undefined) {
      if (inline !== undefined && !same(inline, file[key]))
        warnings.push(differs(key, inline, file[key]));
      Object.assign(merged, { [key]: file[key] });
    }
    if (merged[key] !== undefined) declared.push(key);
  }
  const names = new Set(definition.schedules?.map((s) => s.name));
  for (const name of Object.keys(file.schedules ?? {}))
    if (!names.has(name))
      warnings.push(
        `preprocess.config.json sets schedule ${name}, which the code does not define`,
      );
  if (definition.schedules)
    merged.schedules = definition.schedules.map((schedule) => {
      const key = `schedules.${schedule.name}.previews`;
      const previews = file.schedules?.[schedule.name]?.previews;
      if (previews === undefined) {
        if (schedule.previews !== undefined) declared.push(key);
        return schedule;
      }
      if (schedule.previews !== undefined && schedule.previews !== previews)
        warnings.push(differs(key, schedule.previews, previews));
      declared.push(key);
      return { ...schedule, previews };
    });
  if (config.groups) {
    const listed = new Set(config.groups.map((g) => g.slug));
    for (const slug of definition.groups ?? [])
      if (!listed.has(slug))
        warnings.push(
          `group ${slug} is not in preprocess.config.json's groups`,
        );
  }
  return { merged, declared, warnings };
};

type Env = Record<string, unknown> & { MCP?: McpBinding };

// The agent's Worker. Export it as the module's default export; Preprocess
// deploys it as a stateless Worker and calls it only from the runtime.
export const agent = <const S extends string = never>(
  inline: AgentDefinition<S>,
) => {
  const {
    merged: definition,
    declared,
    warnings,
  } = settle(
    inline,
    typeof __PREPROCESS_CONFIG__ === "undefined" ? {} : __PREPROCESS_CONFIG__,
  );
  check(definition);
  const approvals = approvalsOf(definition);
  const manifest: Manifest = {
    protocol: PROTOCOL,
    sdk: { name: "@preprocess/sdk", version: SDK_VERSION },
    instructions: definition.instructions,
    model: definition.model ?? DEFAULT_MODEL,
    reasoning: definition.reasoning ?? "medium",
    secrets: [...(definition.secrets ?? [])],
    mcp: [...(definition.mcp ?? [])],
    tools: Object.entries(definition.tools).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.input, { io: "input" }),
      sideEffects: t.sideEffects,
    })),
    ...(definition.schema && { schema: serialise(definition.schema) }),
    ...(definition.groups && { groups: [...definition.groups] }),
    ...(definition.schedules && {
      schedules: definition.schedules.map((schedule) => ({
        name: schedule.name,
        cron: schedule.cron.trim(),
        timezone: schedule.timezone ?? "UTC",
        text: schedule.text,
        previews: schedule.previews ?? false,
      })),
    }),
    ...(definition.ocr !== undefined && { ocr: definition.ocr }),
    ...(definition.searchCases !== undefined && {
      searchCases: definition.searchCases,
    }),
    ...(definition.network && { network: [...definition.network] }),
    ...(definition.timeoutSeconds !== undefined && {
      timeoutSeconds: definition.timeoutSeconds,
    }),
    ...(definition.toolRetries !== undefined && {
      toolRetries: definition.toolRetries,
    }),
    ...(definition.sandboxImage !== undefined && {
      sandboxImage: definition.sandboxImage,
    }),
    ...(definition.sandbox && {
      sandbox: sandboxManifest(definition.sandbox),
    }),
    ...(definition.evals && { evals: { ...definition.evals } }),
    ...(approvals && { approvals }),
    declared: definition.sandbox ? [...declared, "sandbox.size"] : declared,
    ...(warnings.length && { warnings }),
  };

  const bound = (env: Env): Secrets =>
    new Map(
      manifest.secrets.flatMap((name) => {
        const value = env[name];
        return typeof value === "string" ? [[name, value] as const] : [];
      }),
    );

  const exposed = (secrets: Secrets) =>
    Object.fromEntries(
      manifest.secrets.map((s) => [s, secrets.get(s)]),
    ) as Record<S, string | undefined>;

  const declaredGroup = (group: string) => {
    if (!manifest.groups?.includes(group))
      throw new Error(
        `Group ${group} is not declared in this agent's groups list`,
      );
  };

  const runTool = async (
    name: string,
    call: ToolCall,
    env: Env,
    mcp: McpBinding | undefined,
  ): Promise<ToolResult> => {
    const definitionTool = definition.tools[name];
    if (!definitionTool)
      return { output: `Unknown tool ${name}`, isError: true };
    const parsed = definitionTool.input.safeParse(call.input);
    if (!parsed.success)
      return { output: z.prettifyError(parsed.error), isError: true };
    // An approval that applies stops the call until a person approves it;
    // a `when` that throws counts as applying.
    const approval = definitionTool.approval;
    if (approval !== undefined && call.approved !== true) {
      let applies = true;
      try {
        applies =
          approval === true ||
          !approval.when ||
          Boolean(approval.when(parsed.data));
      } catch {
        applies = true;
      }
      if (applies)
        return {
          output: null,
          isError: false,
          effects: [
            {
              type: "approval",
              group: approvalRule(approval).group,
              reason: `${name} needs approval before it runs`,
            },
          ],
        };
    }
    const secrets = bound(env);
    const effects: Effect[] = [];
    const ctx: ToolContext<S> = {
      env: exposed(secrets),
      case: { id: call.case.id },
      waitOn: (group, opts = {}) => {
        declaredGroup(group);
        effects.push({ type: "wait", group, reason: opts.reason ?? null });
      },
      tag: (group, message) => {
        declaredGroup(group);
        if (typeof message !== "string" || !message.trim())
          throw new Error("A tag needs a message");
        effects.push({ type: "tag", group, message });
      },
      mcp: (server) => {
        if (!manifest.mcp.includes(server))
          throw new Error(
            `MCP server ${server} is not declared in this agent's mcp list`,
          );
        const binding = mcp;
        if (!binding) throw new Error("This deployment has no MCP binding");
        return {
          listTools: () => binding.listTools(server),
          call: (tool, args = {}) =>
            binding.call(server, tool, args, { caseId: call.case.id }),
        };
      },
    };
    try {
      const output: unknown = await definitionTool.run(parsed.data, ctx);
      return {
        output: redact(output ?? null, secrets),
        isError: false,
        ...(effects.length && {
          effects: redact(effects, secrets) as Effect[],
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        output: redactText(message, secrets),
        isError: true,
        threw: true,
      };
    }
  };

  return {
    manifest,
    async fetch(
      request: Request,
      env: Env,
      ctx?: ExecutionContext,
    ): Promise<Response> {
      redactConsole(bound(env));
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/manifest")
        return Response.json(manifest);
      const root = definition.schema;
      if (
        root &&
        request.method === "POST" &&
        (url.pathname === "/schema/evaluate" ||
          url.pathname === "/schema/options")
      ) {
        const secrets = bound(env);
        const body = await request.json<EvaluateRequest & OptionsRequest>();
        const ctx = { env: exposed(secrets), caseId: body.caseId };
        if (url.pathname === "/schema/evaluate")
          return Response.json(
            redact(
              await evaluate(root, body, ctx, definition.approval),
              secrets,
            ),
          );
        try {
          return Response.json(redact(await options(root, body, ctx), secrets));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return Response.json(
            { error: redactText(message, secrets) },
            { status: error instanceof OptionsError ? 400 : 500 },
          );
        }
      }
      const match = /^\/tools\/([a-z][a-z0-9_]*)$/.exec(url.pathname);
      if (request.method === "POST" && match?.[1]) {
        return Response.json(
          await runTool(
            match[1],
            await request.json<ToolCall>(),
            env,
            // The runtime passes the MCP capability with each dispatch.
            (ctx?.props as { MCP?: McpBinding } | undefined)?.MCP ?? env.MCP,
          ),
        );
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  } satisfies ExportedHandler<Env> & { manifest: Manifest };
};
