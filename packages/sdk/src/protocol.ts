// The contract between the Preprocess runtime and an agent's deployed Worker.
// The runtime reads GET /manifest once per case and calls POST /tools/:name
// for every tool call. Both sides import these types; the protocol number
// changes only on a breaking change, and the runtime supports every protocol
// within an SDK major version (spec 16d).

export const PROTOCOL = 1;

export const MODELS = [
  "inkling-2-mini",
  "inkling-2-small",
  "kimi-k3.1-pro",
] as const;
export type Model = (typeof MODELS)[number];

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

export type Manifest = {
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
};

export type ToolResult = { output: unknown; isError: boolean };

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
