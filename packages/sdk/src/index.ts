import { z } from "zod";

import {
  MODELS,
  PROTOCOL,
  REASONING,
  RESERVED_BINDINGS,
  RESERVED_PREFIX,
  SECRET_NAME,
  type Manifest,
  type McpBinding,
  type Model,
  type Reasoning,
  type ToolCall,
  type ToolResult,
} from "./protocol.ts";
import { redact, redactConsole, redactText, type Secrets } from "./redact.ts";

export type { Manifest, Model, Reasoning } from "./protocol.ts";

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
};

export type Tool<S extends string = string> = {
  description: string;
  input: z.ZodType;
  sideEffects: boolean;
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
  run(input: z.output<I>, ctx: ToolContext<S>): unknown;
}): Tool<S> => ({
  description: definition.description,
  input: definition.input,
  sideEffects: definition.sideEffects ?? false,
  run: (input, ctx) => definition.run(input as z.output<I>, ctx),
});

export type AgentDefinition<S extends string> = {
  instructions: string;
  model?: Model;
  reasoning?: Reasoning;
  secrets?: readonly S[];
  mcp?: readonly string[];
  tools: Record<string, Tool<NoInfer<S>>>;
};

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

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
  if (problems.length) throw new Error(`Invalid agent: ${problems.join("; ")}`);
};

type Env = Record<string, unknown> & { MCP?: McpBinding };

// The agent's Worker. Export it as the module's default export; Preprocess
// deploys it as a stateless Worker and calls it only from the runtime.
export const agent = <const S extends string = never>(
  definition: AgentDefinition<S>,
) => {
  check(definition);
  const manifest: Manifest = {
    protocol: PROTOCOL,
    sdk: { name: "@preprocess/sdk", version: SDK_VERSION },
    instructions: definition.instructions,
    model: definition.model ?? "inkling-2-small",
    reasoning: definition.reasoning ?? "medium",
    secrets: [...(definition.secrets ?? [])],
    mcp: [...(definition.mcp ?? [])],
    tools: Object.entries(definition.tools).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.input, { io: "input" }),
      sideEffects: t.sideEffects,
    })),
  };

  const bound = (env: Env): Secrets =>
    new Map(
      manifest.secrets.flatMap((name) => {
        const value = env[name];
        return typeof value === "string" ? [[name, value] as const] : [];
      }),
    );

  const runTool = async (
    name: string,
    call: ToolCall,
    env: Env,
  ): Promise<ToolResult> => {
    const definitionTool = definition.tools[name];
    if (!definitionTool)
      return { output: `Unknown tool ${name}`, isError: true };
    const parsed = definitionTool.input.safeParse(call.input);
    if (!parsed.success)
      return { output: z.prettifyError(parsed.error), isError: true };
    const secrets = bound(env);
    const ctx: ToolContext<S> = {
      env: Object.fromEntries(
        manifest.secrets.map((s) => [s, secrets.get(s)]),
      ) as Record<S, string | undefined>,
      case: { id: call.case.id },
      mcp: (server) => {
        if (!manifest.mcp.includes(server))
          throw new Error(
            `MCP server ${server} is not declared in this agent's mcp list`,
          );
        const binding = env.MCP;
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
      return { output: redact(output ?? null, secrets), isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: redactText(message, secrets), isError: true };
    }
  };

  return {
    manifest,
    async fetch(request: Request, env: Env): Promise<Response> {
      redactConsole(bound(env));
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/manifest")
        return Response.json(manifest);
      const match = /^\/tools\/([a-z][a-z0-9_]*)$/.exec(url.pathname);
      if (request.method === "POST" && match?.[1]) {
        return Response.json(
          await runTool(match[1], await request.json<ToolCall>(), env),
        );
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  } satisfies ExportedHandler<Env> & { manifest: Manifest };
};
