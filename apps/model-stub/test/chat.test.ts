import { exports } from "cloudflare:workers";

const stub = (exports as unknown as { default: Fetcher }).default;
import { describe, expect, it } from "vitest";

const chat = (body: object, headers: Record<string, string> = {}) =>
  stub.fetch("https://stub/v1/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer test", ...headers },
    body: JSON.stringify(body),
  });

const tools = ["lookup_stock", "carrier_status", "find_contact"].map(
  (name) => ({
    type: "function",
    function: { name },
  }),
);

describe("chat completions stub", () => {
  it("requires a bearer token", async () => {
    const response = await stub.fetch("https://stub/v1/chat/completions", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(401);
  });

  it("plays a fixture's turns in order", async () => {
    const user = { role: "user", content: "Check stock for SKU A1 please" };
    const first = await chat({ messages: [user], tools });
    const body = await first.json<{
      choices: Array<{
        message: {
          tool_calls: Array<{ function: { name: string; arguments: string } }>;
        };
      }>;
    }>();
    expect(body.choices[0]!.message.tool_calls[0]!.function).toEqual({
      name: "lookup_stock",
      arguments: JSON.stringify({ sku: "A1" }),
    });
    const last = await chat({
      messages: [
        user,
        {
          role: "assistant",
          tool_calls: [{ id: "a", function: { name: "lookup_stock" } }],
        },
        { role: "tool", tool_call_id: "a", content: "12 in stock" },
        { role: "assistant", tool_calls: [] },
        { role: "assistant", tool_calls: [] },
      ],
      tools,
    });
    expect(await last.json()).toMatchObject({
      choices: [
        {
          message: { content: "SKU A1 checked. Results: 12 in stock" },
          finish_reason: "stop",
        },
      ],
    });
  });

  it("streams in the OpenAI chunk shape", async () => {
    const response = await chat({
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    });
    const body = await response.text();
    expect(body).toContain('"object":"chat.completion.chunk"');
    expect(body).toContain("data: [DONE]");
  });

  it("simulates failures on request", async () => {
    const response = await chat(
      { messages: [{ role: "user", content: "x" }] },
      { "x-stub-fail": "503" },
    );
    expect(response.status).toBe(503);
  });
});
