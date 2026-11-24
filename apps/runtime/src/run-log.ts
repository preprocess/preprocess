import type { CaptureEvent } from "./capture.ts";

// Which capture events also become run-log wide events (design doc 09), and
// what they carry. Capture keeps the full record; the log keeps what people
// search for: the outcome, timing and errors, never prompts or tool output.
export type RunLogEntry = {
  kind: string;
  level: "info" | "warn" | "error";
  fields: Record<string, unknown>;
  ms?: number;
};

const ms = (data: Record<string, unknown>) =>
  typeof data.ms === "number" ? { ms: data.ms } : {};

const short = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text && text.length > 500 ? text.slice(0, 500) + "…" : text;
};

const ended = (kind: string) => kind.slice("case.".length);

export const runLogEntry = (
  kind: CaptureEvent["kind"],
  data: Record<string, unknown>,
): RunLogEntry | null => {
  switch (kind) {
    case "case.started":
      return {
        kind: "case.started",
        level: "info",
        fields: {
          message: "Case started",
          sdk: data.sdk,
          model: data.model,
          reasoning: data.reasoning,
        },
      };
    case "model.response": {
      const failed = data.stopReason === "error";
      const reply = data.message as { errorMessage?: string } | undefined;
      return {
        kind: "model.call",
        level: failed ? "error" : "info",
        fields: {
          message:
            "Model call " + String(data.turn) + ": " + String(data.stopReason),
          turn: data.turn,
          stopReason: data.stopReason,
          usage: data.usage,
          ...(failed && {
            error: { message: short(reply?.errorMessage ?? "model error") },
          }),
        },
        ...ms(data),
      };
    }
    case "model.error":
      return {
        kind: "model.call",
        level: "error",
        fields: {
          message: "Model call " + String(data.turn) + " failed",
          turn: data.turn,
          error: { message: short(data.error) },
        },
        ...ms(data),
      };
    case "tool.result":
      return {
        kind: "tool.call",
        level: data.isError ? "warn" : "info",
        fields: {
          message: String(data.name) + (data.isError ? " failed" : ""),
          tool: data.name,
          callId: data.callId,
          ...(data.isError ? { error: { message: short(data.output) } } : {}),
        },
        ...ms(data),
      };
    case "context.summary":
      return {
        kind: "context.summary",
        level: data.error ? "warn" : "info",
        fields: {
          message: data.error ? "Large summary failed" : "Context summarized",
          entries: data.entries,
          chars: data.chars,
          usage: data.usage,
          ...(data.error ? { error: { message: short(data.error) } } : {}),
        },
        ...ms(data),
      };
    case "case.completed":
    case "case.failed":
    case "case.halted":
      return {
        kind: "case.run",
        level:
          kind === "case.completed"
            ? "info"
            : kind === "case.failed"
              ? "error"
              : "warn",
        fields: {
          message: "Case " + ended(kind),
          status: data.status ?? ended(kind),
          ...(kind !== "case.completed" && {
            error: { message: short(data.reason ?? ended(kind)) },
          }),
        },
      };
    case "case.wait":
      return {
        kind: "case.wait",
        level: "info",
        fields: {
          message: "Waiting on " + String(data.group),
          group: data.group,
        },
      };
    case "platform.error":
    case "schema.error":
      return {
        kind,
        level: "error",
        fields: { message: kind, error: { message: short(data.error) } },
      };
    case "ocr":
      return data.error
        ? {
            kind: "ocr",
            level: "warn",
            fields: {
              message: "OCR failed",
              fileId: data.fileId,
              error: { message: short(data.error) },
            },
          }
        : null;
    default:
      return null;
  }
};
