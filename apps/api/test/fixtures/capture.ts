// A small run capture (format preprocess.run v1) in the shape
// apps/runtime/src/case-runtime.ts writes: one case where the model reads
// the input, answers two fields with schema_answer and then finishes.

import type { RunCapture } from "../../src/env.ts";

export const fixtureCapture = (c: {
  organizationId: string;
  agentId: string;
  deploymentId: string;
  caseId: string;
}): RunCapture => {
  const system = {
    role: "system",
    content: "Extract the vendor and the total from the invoice.",
  };
  const user = {
    role: "user",
    content: "Invoice from Globex, total 120.00 USD",
    timestamp: 1_795_000_000_000,
  };
  const answer = {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "call_1",
        name: "schema_answer",
        arguments: {
          answers: [
            { path: "vendor", value: "Globex" },
            { path: "total", value: 12 },
          ],
        },
      },
    ],
    api: "openai-completions",
    provider: "model-stub",
    model: "kimi-k3.1-pro",
    usage: { input: 40, output: 12 },
    stopReason: "toolUse",
    timestamp: 1_795_000_001_000,
  };
  const toolResult = {
    role: "toolResult",
    toolCallId: "call_1",
    toolName: "schema_answer",
    content: [
      {
        type: "text",
        text: JSON.stringify([
          {
            result: "ok",
            path: "vendor",
            before: null,
            after: "Globex",
            stale: [],
            shown: [],
            hidden: [],
          },
          {
            result: "ok",
            path: "total",
            before: null,
            after: 12,
            stale: [],
            shown: [],
            hidden: [],
          },
        ]),
      },
    ],
    isError: false,
    timestamp: 1_795_000_001_500,
  };
  const done = {
    role: "assistant",
    content: [{ type: "text", text: "Vendor Globex, total 12." }],
    api: "openai-completions",
    provider: "model-stub",
    model: "kimi-k3.1-pro",
    usage: { input: 70, output: 8 },
    stopReason: "stop",
    timestamp: 1_795_000_002_000,
  };
  const at = (s: number) =>
    new Date(1_795_000_000_000 + s * 1000).toISOString();
  return {
    format: "preprocess.run",
    version: 1,
    ...c,
    sdkVersion: "0.1.0",
    model: "kimi-k3.1-pro",
    status: "completed",
    usage: {
      input: 110,
      output: 20,
      costMicroUsd: 300,
      charges: { model: 300, decide: 0, ocr: 0 },
    },
    events: [
      {
        seq: 1,
        at: at(0),
        kind: "case.started",
        data: { input: { text: user.content } },
      },
      {
        seq: 2,
        at: at(0),
        kind: "model.request",
        data: {
          turn: 1,
          model: "kimi-k3.1-pro",
          context: { messages: [system, user] },
        },
      },
      {
        seq: 3,
        at: at(1),
        kind: "model.response",
        data: {
          turn: 1,
          ms: 900,
          stopReason: "toolUse",
          usage: answer.usage,
          message: answer,
        },
      },
      {
        seq: 4,
        at: at(1),
        kind: "tool.call",
        data: {
          callId: "call_1",
          name: "schema_answer",
          input: answer.content[0]!.arguments,
        },
      },
      {
        seq: 5,
        at: at(1),
        kind: "schema.answer",
        data: {
          results: [
            { result: "ok", path: "vendor", after: "Globex" },
            { result: "ok", path: "total", after: 12 },
          ],
        },
      },
      {
        seq: 6,
        at: at(1),
        kind: "tool.result",
        data: {
          callId: "call_1",
          name: "schema_answer",
          output: toolResult.content,
          isError: false,
        },
      },
      {
        seq: 7,
        at: at(1),
        kind: "model.request",
        data: {
          turn: 2,
          model: "kimi-k3.1-pro",
          context: { messages: [system, user, answer, toolResult] },
        },
      },
      {
        seq: 8,
        at: at(2),
        kind: "model.response",
        data: {
          turn: 2,
          ms: 500,
          stopReason: "stop",
          usage: done.usage,
          message: done,
        },
      },
      {
        seq: 9,
        at: at(2),
        kind: "case.completed",
        data: { answer: "Vendor Globex, total 12.", status: "completed" },
      },
    ],
  };
};
