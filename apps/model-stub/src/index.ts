import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import fixtures from "../fixtures/chat.json";

type Message = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: string | Array<{ type: string; text?: string }> | null;
  tool_calls?: Array<{ id: string; function: { name: string } }>;
  tool_call_id?: string;
};

type ChatRequest = {
  model?: string;
  messages?: Message[];
  stream?: boolean;
  tools?: Array<{ function: { name: string } }>;
};

type Turn = {
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  content?: string;
};

const text = (content: Message["content"]) =>
  typeof content === "string"
    ? content
    : (content ?? []).map((part) => part.text ?? "").join("");

const FALLBACK =
  "Stub reply: no fixture matches this conversation, so no model was called.";

// One reply per request, chosen only from the request, so a rerun of the same
// conversation gets the same answer.
export const reply = (request: ChatRequest): Turn => {
  const messages = request.messages ?? [];
  const firstUser = messages.find((m) => m.role === "user");
  const fixture = (fixtures as Array<{ match: string; turns: Turn[] }>).find(
    (f) => firstUser && text(firstUser.content).includes(f.match),
  );
  if (!fixture) return { content: FALLBACK };
  // Turns that call tools this agent does not have are skipped, so one
  // fixture serves agents with fewer tools.
  const offered = new Set((request.tools ?? []).map((t) => t.function.name));
  const turns = fixture.turns.filter((turn) =>
    (turn.toolCalls ?? []).every((call) => offered.has(call.name)),
  );
  const step = messages.filter((m) => m.role === "assistant").length;
  const turn = turns[Math.min(step, turns.length - 1)]!;
  if (turn.content === undefined) return turn;
  const results = messages
    .filter((m) => m.role === "tool")
    .map((m) => text(m.content))
    .join(" | ");
  return { content: turn.content.replace("{{results}}", results) };
};

const app = new Hono<{ Bindings: { STUB_LATENCY_MS?: string } }>();

app.use("/v1/*", async (c, next) => {
  const auth = c.req.header("authorization") ?? "";
  if (!/^Bearer \S+/.test(auth))
    return c.json({ error: { message: "missing bearer token" } }, 401);
  const latency = Number(
    c.req.header("x-stub-latency-ms") ?? c.env.STUB_LATENCY_MS ?? 0,
  );
  if (latency > 0) await new Promise((r) => setTimeout(r, latency));
  const fail = c.req.header("x-stub-fail");
  if (fail === "429" || fail === "500" || fail === "503")
    return c.json(
      { error: { message: `stub failure ${fail}` } },
      Number(fail) as 429,
    );
  await next();
});

app.post("/v1/chat/completions", async (c) => {
  const request = await c.req.json<ChatRequest>();
  if (!Array.isArray(request.messages) || request.messages.length === 0)
    return c.json({ error: { message: "messages is required" } }, 400);
  const turn = reply(request);
  const id = `chatcmpl-stub-${request.messages.length}`;
  const model = request.model ?? "stub";
  const promptTokens = Math.ceil(JSON.stringify(request.messages).length / 4);
  const toolCalls = (turn.toolCalls ?? []).map((call, index) => ({
    index,
    id: `call_${request.messages!.length}_${index}`,
    type: "function" as const,
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }));
  const content = turn.content ?? null;
  const completionTokens = Math.ceil(
    ((content ?? "").length + JSON.stringify(toolCalls).length) / 4,
  );
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
  const finish = toolCalls.length ? "tool_calls" : "stop";
  if (!request.stream) {
    return c.json({
      id,
      object: "chat.completion",
      created: 0,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
            ...(toolCalls.length && { tool_calls: toolCalls }),
          },
          finish_reason: finish,
        },
      ],
      usage,
    });
  }
  return streamSSE(c, async (stream) => {
    const chunk = (choices: unknown[], extra: object = {}) =>
      stream.writeSSE({
        data: JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created: 0,
          model,
          choices,
          ...extra,
        }),
      });
    await chunk([
      {
        index: 0,
        delta: {
          role: "assistant",
          content,
          ...(toolCalls.length && { tool_calls: toolCalls }),
        },
        finish_reason: null,
      },
    ]);
    await chunk([{ index: 0, delta: {}, finish_reason: finish }]);
    await chunk([], { usage });
    await stream.writeSSE({ data: "[DONE]" });
  });
});

export default app;
