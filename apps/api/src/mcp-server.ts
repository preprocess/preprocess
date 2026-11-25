// The MCP server for managing Preprocess (spec 14, mvp-surface §MCP): one
// tool per API operation that makes sense to an agent, generated from the
// API's own OpenAPI document. A tool call becomes a request to that
// operation with the caller's organization API key, so the API's own
// permission checks apply. Stateless streamable HTTP: each POST carries one
// JSON-RPC message and gets a JSON answer.
//
// Not here on purpose: identity, groups, keys, secrets, GitHub, MCP
// connections, webhooks, OpenTelemetry, audit, and decisions only a person
// makes (approvals, memory rules, guardrail requests).

type Method = "get" | "post" | "put" | "patch" | "delete";

// Tool name → operation. A test checks every entry exists in the document.
export const TOOLS: Record<
  string,
  { method: Method; path: string; destructive?: true; fallback?: string }
> = {
  list_agents: {
    method: "get",
    path: "/agents",
    fallback: "List the organization's agents",
  },
  get_agent: {
    method: "get",
    path: "/agents/{agent}",
    fallback: "An agent with its production deployment",
  },
  archive_agent: {
    method: "post",
    path: "/agents/{agent}/archive",
    destructive: true,
    fallback: "Archive an agent",
  },
  list_deployments: {
    method: "get",
    path: "/agents/{agent}/deployments",
    fallback: "An agent's deployments, newest first",
  },
  get_deployment: {
    method: "get",
    path: "/agents/{agent}/deployments/{deployment}",
    fallback:
      "One deployment: what it pins, its warnings and the guardrails it waits on",
  },
  promote_deployment: {
    method: "post",
    path: "/agents/{agent}/deployments/{deployment}/promote",
    destructive: true,
  },
  list_builds: { method: "get", path: "/agents/{agent}/builds" },
  get_build: { method: "get", path: "/agents/{agent}/builds/{build}" },
  get_agent_settings: { method: "get", path: "/agents/{agent}/settings" },
  set_agent_setting: { method: "put", path: "/agents/{agent}/settings/{key}" },
  clear_agent_setting: {
    method: "delete",
    path: "/agents/{agent}/settings/{key}",
  },
  get_defaults: { method: "get", path: "/defaults" },
  get_agent_network: { method: "get", path: "/agents/{agent}/network" },
  list_guardrail_requests: { method: "get", path: "/guardrail-requests" },
  request_guardrail_change: { method: "post", path: "/guardrail-requests" },
  get_spending: { method: "get", path: "/spending" },
  list_schedules: { method: "get", path: "/agents/{agent}/schedules" },
  pause_schedule: {
    method: "post",
    path: "/agents/{agent}/schedules/{name}/pause",
  },
  resume_schedule: {
    method: "post",
    path: "/agents/{agent}/schedules/{name}/resume",
  },
  list_cases: { method: "get", path: "/cases" },
  get_case: { method: "get", path: "/cases/{id}" },
  create_case: { method: "post", path: "/cases" },
  get_case_room: { method: "get", path: "/cases/{id}/room" },
  edit_answer: { method: "patch", path: "/cases/{id}/answers" },
  confirm_answer: { method: "post", path: "/cases/{id}/answers/confirm" },
  accept_suggestion: { method: "post", path: "/cases/{id}/answers/accept" },
  search_field_options: { method: "post", path: "/cases/{id}/options" },
  post_case_message: { method: "post", path: "/cases/{id}/messages" },
  rerun_case: { method: "post", path: "/cases/{id}/rerun" },
  cancel_case: {
    method: "post",
    path: "/cases/{id}/cancel",
    destructive: true,
  },
  assign_case: { method: "put", path: "/cases/{id}/assignees" },
  get_case_logs: { method: "get", path: "/cases/{id}/logs" },
  search_logs: { method: "get", path: "/logs" },
  list_eval_suites: { method: "get", path: "/agents/{agent}/eval-suites" },
  create_eval_suite: { method: "post", path: "/agents/{agent}/eval-suites" },
  get_eval_suite: { method: "get", path: "/eval-suites/{suite}" },
  update_eval_suite: { method: "patch", path: "/eval-suites/{suite}" },
  delete_eval_suite: {
    method: "delete",
    path: "/eval-suites/{suite}",
    destructive: true,
  },
  add_eval_suite_cases: { method: "post", path: "/eval-suites/{suite}/cases" },
  remove_eval_suite_cases: {
    method: "delete",
    path: "/eval-suites/{suite}/cases",
    destructive: true,
  },
  run_eval_suite: { method: "post", path: "/eval-suites/{suite}/runs" },
  get_eval_run: { method: "get", path: "/eval-runs/{run}" },
  list_agent_memories: { method: "get", path: "/agents/{agent}/memories" },
  list_case_memories: { method: "get", path: "/cases/{id}/memories" },
  delete_agent_memory: {
    method: "delete",
    path: "/agents/{agent}/memories/{memory}",
    destructive: true,
  },
};

type Schema = Record<string, unknown>;
type OpenApi = {
  paths: Record<string, Partial<Record<Method, OperationObject>>>;
  components?: { schemas?: Record<string, Schema> };
};
type OperationObject = {
  summary?: string;
  description?: string;
  parameters?: {
    name: string;
    in: "path" | "query" | "header" | "cookie";
    required?: boolean;
    description?: string;
    schema?: Schema;
  }[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
};

export type Tool = {
  name: string;
  description: string;
  inputSchema: Schema;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
  };
  call: {
    method: Method;
    path: string;
    path_params: string[];
    query: string[];
    body: string[];
  };
};

const ORG_PREFIX = "/orgs/{org}";

// Inlines #/components/schemas references, which MCP clients do not resolve.
const inline = (
  schema: unknown,
  doc: OpenApi,
  seen: string[] = [],
): unknown => {
  if (Array.isArray(schema)) return schema.map((s) => inline(s, doc, seen));
  if (!schema || typeof schema !== "object") return schema;
  const ref = (schema as { $ref?: string }).$ref;
  if (ref?.startsWith("#/components/schemas/")) {
    const name = ref.slice("#/components/schemas/".length);
    if (seen.includes(name)) return {};
    return inline(doc.components?.schemas?.[name] ?? {}, doc, [...seen, name]);
  }
  return Object.fromEntries(
    Object.entries(schema).map(([k, v]) => [k, inline(v, doc, seen)]),
  );
};

// Path and query parameters and the JSON body's properties become one flat
// input object; the organization comes from the MCP endpoint's URL.
export const buildTools = (doc: OpenApi): Tool[] =>
  Object.entries(TOOLS).map(([name, entry]) => {
    const op = doc.paths[ORG_PREFIX + entry.path]?.[entry.method];
    if (!op)
      throw new Error(
        `MCP tool ${name}: no ${entry.method.toUpperCase()} ${entry.path}`,
      );
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const pathParams: string[] = [];
    const query: string[] = [];
    for (const p of op.parameters ?? []) {
      if (p.name === "org" || (p.in !== "path" && p.in !== "query")) continue;
      properties[p.name] = inline(
        { ...p.schema, ...(p.description && { description: p.description }) },
        doc,
      );
      if (p.required || p.in === "path") required.push(p.name);
      (p.in === "path" ? pathParams : query).push(p.name);
    }
    const bodySchema = inline(
      op.requestBody?.content?.["application/json"]?.schema,
      doc,
    ) as
      { properties?: Record<string, unknown>; required?: string[] } | undefined;
    const body = Object.keys(bodySchema?.properties ?? {});
    for (const key of body) {
      if (key in properties)
        throw new Error(
          `MCP tool ${name}: body field ${key} clashes with a parameter`,
        );
      properties[key] = bodySchema!.properties![key];
    }
    required.push(...(bodySchema?.required ?? []));
    const summary = op.summary || entry.fallback || name;
    return {
      name,
      description: [summary, op.description].filter(Boolean).join(". "),
      inputSchema: {
        type: "object",
        properties,
        ...(required.length && { required: [...new Set(required)] }),
      },
      annotations: {
        title: summary,
        readOnlyHint: entry.method === "get",
        destructiveHint: entry.destructive === true,
        idempotentHint: entry.method === "get" || entry.method === "put",
      },
      call: {
        method: entry.method,
        path: entry.path,
        path_params: pathParams,
        query,
        body,
      },
    };
  });

const scalar = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);

// The request a tool call makes, relative to /v1/orgs/{org}.
export const toolRequest = (tool: Tool, args: Record<string, unknown>) => {
  for (const key of tool.call.path_params)
    if (args[key] === undefined || args[key] === "")
      throw new Error(`Missing ${key}.`);
  const path = tool.call.path.replace(/\{(\w+)\}/g, (_, key: string) =>
    encodeURIComponent(scalar(args[key])),
  );
  const search = new URLSearchParams();
  for (const key of tool.call.query)
    if (args[key] !== undefined && args[key] !== null)
      search.set(key, scalar(args[key]));
  const body = Object.fromEntries(
    tool.call.body
      .filter((k) => args[k] !== undefined)
      .map((k) => [k, args[k]]),
  );
  const hasBody = tool.call.method !== "get" && tool.call.method !== "delete";
  return {
    method: tool.call.method.toUpperCase(),
    path: search.size ? `${path}?${search.toString()}` : path,
    body: hasBody || tool.call.body.length ? JSON.stringify(body) : undefined,
  };
};

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

type JsonRpc = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

const ok = (id: JsonRpc["id"], result: unknown) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  result,
});
const fail = (id: JsonRpc["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

// Answers one JSON-RPC message, or null for a notification.
export const handleMcp = async (
  message: JsonRpc,
  tools: () => Tool[],
  send: (request: {
    method: string;
    path: string;
    body: string | undefined;
  }) => Response | Promise<Response>,
) => {
  if (message?.jsonrpc !== "2.0" || typeof message.method !== "string")
    return fail(message?.id, -32600, "Invalid request");
  if (message.id === undefined) return null;
  switch (message.method) {
    case "initialize": {
      const asked = message.params?.protocolVersion;
      return ok(message.id, {
        protocolVersion:
          typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked)
            ? asked
            : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "preprocess",
          title: "Preprocess",
          version: "1.0.0",
        },
        instructions:
          "Manage this organization's Preprocess agents: deployments, settings, cases, evals, logs and memory rules. Agents are referred to by slug. Approvals, memory decisions and guardrail requests are decided by people in the app, not here.",
      });
    }
    case "ping":
      return ok(message.id, {});
    case "tools/list":
      return ok(message.id, {
        tools: tools().map(({ call: _call, ...tool }) => tool),
      });
    case "tools/call": {
      const name = message.params?.name;
      const tool = tools().find((t) => t.name === name);
      if (!tool)
        return fail(message.id, -32602, `Unknown tool: ${scalar(name)}`);
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      let request;
      try {
        request = toolRequest(tool, args);
      } catch (error) {
        return ok(message.id, {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        });
      }
      const response = await send(request);
      const text = await response.text();
      return ok(message.id, {
        content: [{ type: "text", text: text || `${response.status}` }],
        isError: response.status >= 400,
      });
    }
    default:
      return fail(message.id, -32601, `Method not found: ${message.method}`);
  }
};
