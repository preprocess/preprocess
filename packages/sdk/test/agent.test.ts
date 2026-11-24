import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { agent, SDK_VERSION, tool } from "../src/index.ts";
import type { Manifest, McpBinding, ToolResult } from "../src/protocol.ts";
import pkg from "../package.json";

const sample = agent({
  instructions: "Answer stock questions.",
  secrets: ["ERP_TOKEN"],
  mcp: ["crm"],
  tools: {
    lookup: tool({
      description: "Look up a SKU",
      input: z.object({ sku: z.string() }),
      run: ({ sku }, { env }) => ({
        sku,
        stock: 3,
        auth: `Bearer ${env.ERP_TOKEN}`,
      }),
    }),
    fail: tool({
      description: "Always fails",
      input: z.object({}),
      run: (_input, { env }) => {
        throw new Error(`ERP refused token ${env.ERP_TOKEN}`);
      },
    }),
    contact: tool({
      description: "Find a CRM contact",
      input: z.object({ q: z.string() }),
      sideEffects: false,
      run: ({ q }, ctx) => ctx.mcp("crm").call("search", { q }),
    }),
    other: tool({
      description: "Uses an undeclared server",
      input: z.object({}),
      run: (_input, ctx) => ctx.mcp("billing").call("x"),
    }),
  },
});

const env = { ERP_TOKEN: "erp-secret-123", UNRELATED: "keep" };

const call = async (
  name: string,
  input: unknown,
  e: Record<string, unknown> = env,
  props?: Record<string, unknown>,
) => {
  const response = await sample.fetch(
    new Request(`https://agent/tools/${name}`, {
      method: "POST",
      body: JSON.stringify({ input, case: { id: "case_1" }, callId: "c1" }),
    }),
    e,
    props && ({ props } as unknown as ExecutionContext),
  );
  return response.json<ToolResult>();
};

describe("manifest", () => {
  it("describes the agent with JSON schemas and the SDK version", async () => {
    const response = await sample.fetch(
      new Request("https://agent/manifest"),
      env,
    );
    const manifest = await response.json<Manifest>();
    expect(manifest).toMatchObject({
      protocol: 1,
      sdk: { name: "@preprocess/sdk", version: SDK_VERSION },
      model: "inkling-2-small",
      reasoning: "medium",
      secrets: ["ERP_TOKEN"],
      mcp: ["crm"],
    });
    expect(manifest.tools[0]).toMatchObject({
      name: "lookup",
      sideEffects: false,
      inputSchema: {
        type: "object",
        properties: { sku: { type: "string" } },
        required: ["sku"],
      },
    });
  });

  it("keeps SDK_VERSION equal to the package version", () => {
    expect(SDK_VERSION).toBe(pkg.version);
  });

  it("rejects reserved and malformed secret names", () => {
    expect(() =>
      agent({ instructions: "x", secrets: ["MCP"], tools: {} }),
    ).toThrow(/reserved/);
    expect(() =>
      agent({ instructions: "x", secrets: ["PREPROCESS_X"], tools: {} }),
    ).toThrow(/reserved/);
    expect(() =>
      agent({ instructions: "x", secrets: ["lower"], tools: {} }),
    ).toThrow(/must match/);
  });
});

describe("tool calls", () => {
  it("validates input", async () => {
    expect(await call("lookup", { sku: 4 })).toMatchObject({ isError: true });
  });

  it("redacts bound secret values from results and errors", async () => {
    expect(await call("lookup", { sku: "A1" })).toEqual({
      output: { sku: "A1", stock: 3, auth: "Bearer [redacted:ERP_TOKEN]" },
      isError: false,
    });
    expect(await call("fail", {})).toEqual({
      output: "ERP refused token [redacted:ERP_TOKEN]",
      isError: true,
    });
  });

  it("redacts bound secret values from logs", async () => {
    const spy = vi.fn();
    const original = console.log;
    console.log = spy;
    vi.resetModules();
    try {
      const sdk = await import("../src/index.ts");
      const logging = sdk.agent({
        instructions: "x",
        secrets: ["ERP_TOKEN"],
        tools: {
          log: sdk.tool({
            description: "logs",
            input: z.object({}),
            run: (_i, { env: e }) => {
              console.log("token", e.ERP_TOKEN, { nested: e.ERP_TOKEN });
            },
          }),
        },
      });
      await logging.fetch(
        new Request("https://agent/tools/log", {
          method: "POST",
          body: JSON.stringify({ input: {}, case: { id: "c" }, callId: "1" }),
        }),
        env,
      );
    } finally {
      console.log = original;
    }
    expect(spy).toHaveBeenCalledOnce();
    expect(JSON.stringify(spy.mock.calls)).not.toContain("erp-secret-123");
  });

  it("only exposes declared secrets", async () => {
    const peek = agent({
      instructions: "x",
      secrets: ["ERP_TOKEN"],
      tools: {
        peek: tool({
          description: "peek",
          input: z.object({}),
          run: (_i, ctx) => Object.keys(ctx.env),
        }),
      },
    });
    const response = await peek.fetch(
      new Request("https://agent/tools/peek", {
        method: "POST",
        body: JSON.stringify({ input: {}, case: { id: "c" }, callId: "1" }),
      }),
      env,
    );
    expect(await response.json()).toEqual({
      output: ["ERP_TOKEN"],
      isError: false,
    });
  });

  it("calls declared MCP servers through the capability the runtime passes", async () => {
    const mcp: McpBinding = {
      listTools: () => Promise.resolve([]),
      call: (server, toolName, args, opts) =>
        Promise.resolve({ server, toolName, args, opts }),
    };
    expect(await call("contact", { q: "ada" }, { ...env, MCP: mcp })).toEqual({
      output: {
        server: "crm",
        toolName: "search",
        args: { q: "ada" },
        opts: { caseId: "case_1" },
      },
      isError: false,
    });
    expect(
      await call("contact", { q: "ada" }, env, { MCP: mcp }),
    ).toMatchObject({ output: { server: "crm" }, isError: false });
    expect(await call("other", {}, { ...env, MCP: mcp })).toMatchObject({
      isError: true,
      output: expect.stringContaining("not declared") as string,
    });
  });
});
