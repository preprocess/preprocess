import { CompactionTask } from "@earendil-works/pi-durable";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { openModels } from "../src/models.ts";
import {
  largeSummaries,
  SUMMARY_TOKENS,
  transcript,
} from "../src/summaries.ts";

type BeforeCompact = (
  compaction: unknown,
) => Promise<{ summary: string } | undefined>;

// The extension's one hook, as Pi's CompactionTask calls it.
const beforeCompact = (extension: ReturnType<typeof largeSummaries>) => {
  const entry = (
    extension.hooks as unknown as Array<{ task: string; handlers: unknown }>
  ).find((h) => h.task === CompactionTask.definition.name)!;
  return (entry.handlers as { beforeCompact: BeforeCompact }).beforeCompact;
};

const messages = [
  {
    role: "user",
    content: "Invoice INV-204 from Acme, total 1,240.00 EUR.",
    timestamp: 1,
  },
  {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "c1",
        name: "lookup_vendor",
        arguments: { name: "Acme" },
      },
    ],
    timestamp: 2,
  },
  {
    role: "toolResult",
    toolCallId: "c1",
    toolName: "lookup_vendor",
    content: [{ type: "text", text: "vendor V-88, net 30" }],
    isError: false,
    timestamp: 3,
  },
];

describe("large summaries", () => {
  it("writes the transcript a summary is made from with every value kept", () => {
    expect(transcript(messages as never)).toBe(
      [
        "[Case]: Invoice INV-204 from Acme, total 1,240.00 EUR.",
        '[Agent]: call lookup_vendor {"name":"Acme"}',
        "[lookup_vendor]: vendor V-88, net 30",
      ].join("\n\n"),
    );
  });

  it("asks the case's model for one large summary at its reasoning level", async () => {
    const seen: Array<{ maxTokens?: number; reasoning?: string }> = [];
    const models = openModels(env, (fn) => (model, context, options) => {
      seen.push(options as never);
      return fn(model, context, options);
    });
    const recorded: Record<string, unknown>[] = [];
    const hook = beforeCompact(
      largeSummaries(models, "inkling-2-small", "high", (d) =>
        recorded.push(d),
      ),
    );
    const result = await hook({
      reason: "threshold",
      entries: [{}, {}, {}],
      messages,
      firstKept: "e4",
    });
    expect(result?.summary).toMatch(/^Stub reply/);
    expect(seen[0]).toMatchObject({
      maxTokens: SUMMARY_TOKENS,
      reasoning: "high",
    });
    expect(recorded[0]).toMatchObject({ reason: "threshold", entries: 3 });
    expect(recorded[0]).not.toHaveProperty("error");
  });

  it("leaves the summary to Pi when the model call fails", async () => {
    // The model service answers 404 for a model it doesn't serve.
    const models = openModels(
      env,
      (fn) => (model, context, options) =>
        fn({ ...model, id: "retired-model" }, context, options),
    );
    const recorded: Record<string, unknown>[] = [];
    const hook = beforeCompact(
      largeSummaries(models, "inkling-2-small", "low", (d) => recorded.push(d)),
    );
    expect(
      await hook({
        reason: "overflow",
        entries: [],
        messages,
        firstKept: "e1",
      }),
    ).toBeUndefined();
    expect(recorded[0]).toHaveProperty("error");
  });
});
