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
      model: "deepseek-v4.1-flash",
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

  it("runs on an organization model by its org:<slug> id", async () => {
    const own = agent({
      instructions: "x",
      model: "org:invoices-v2",
      tools: {},
    });
    const manifest = await (
      await own.fetch(new Request("https://agent/manifest"), {})
    ).json<Manifest>();
    expect(manifest.model).toBe("org:invoices-v2");
    expect(() =>
      agent({ instructions: "x", model: "org:Not Valid", tools: {} }),
    ).toThrow(/org:<slug>/);
  });
});

describe("settings", () => {
  const manifestOf = async (a: ReturnType<typeof agent>) =>
    (await a.fetch(new Request("https://agent/manifest"), {})).json<Manifest>();
  const withConfig = <T>(config: unknown, build: () => T) => {
    const g = globalThis as { __PREPROCESS_CONFIG__?: unknown };
    g.__PREPROCESS_CONFIG__ = config;
    try {
      return build();
    } finally {
      delete g.__PREPROCESS_CONFIG__;
    }
  };

  it("names the settings the code set, apart from the SDK's defaults", async () => {
    const manifest = await manifestOf(
      agent({
        instructions: "x",
        tools: {},
        reasoning: "high",
        network: ["api.erp.test"],
        timeoutSeconds: 300,
        evals: { onPush: true },
      }),
    );
    expect(manifest).toMatchObject({
      model: "deepseek-v4.1-flash",
      reasoning: "high",
      network: ["api.erp.test"],
      timeoutSeconds: 300,
      evals: { onPush: true },
    });
    expect(manifest.declared).toEqual([
      "reasoning",
      "network",
      "timeoutSeconds",
      "evals",
    ]);
    expect(manifest.warnings).toBeUndefined();
  });

  it("lets preprocess.config.json win, and warns where the code disagrees", async () => {
    const manifest = await manifestOf(
      withConfig(
        {
          settings: {
            model: "kimi-k3.1-pro",
            reasoning: "high",
            toolRetries: 2,
            schedules: {
              nightly: { previews: true },
              gone: { previews: true },
            },
          },
          groups: [{ slug: "finance", name: "Finance" }],
        },
        () =>
          agent({
            instructions: "x",
            tools: {},
            reasoning: "low",
            groups: ["finance", "ops"],
            schedules: [{ name: "nightly", cron: "0 2 * * *", text: "Run" }],
          }),
      ),
    );
    expect(manifest).toMatchObject({
      model: "kimi-k3.1-pro",
      reasoning: "high",
      toolRetries: 2,
      schedules: [{ name: "nightly", previews: true }],
    });
    expect(manifest.declared).toEqual([
      "model",
      "reasoning",
      "toolRetries",
      "schedules.nightly.previews",
    ]);
    expect(manifest.warnings).toEqual([
      'reasoning is "low" in code but "high" in preprocess.config.json, which wins',
      "preprocess.config.json sets schedule gone, which the code does not define",
      "group ops is not in preprocess.config.json's groups",
    ]);
  });

  it("checks the file's values like inline ones", () => {
    expect(() =>
      withConfig({ settings: { timeoutSeconds: 0 } }, () =>
        agent({ instructions: "x", tools: {} }),
      ),
    ).toThrow(/timeoutSeconds/);
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
      threw: true,
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
