import type { TimelineStep, StepState } from "../types/timeline";

function calculateDiffStatsFromPatch(
  patches: Array<{ lines?: string[] }>,
): string | undefined {
  let addedLines = 0;
  let removedLines = 0;

  for (const patch of patches) {
    if (!patch.lines) continue;
    for (const line of patch.lines) {
      if (line.startsWith("+")) addedLines++;
      else if (line.startsWith("-")) removedLines++;
    }
  }

  if (addedLines === 0 && removedLines === 0) return undefined;

  const parts: string[] = [];
  if (addedLines > 0) parts.push(`+${addedLines}`);
  if (removedLines > 0) parts.push(`-${removedLines}`);
  return parts.join(" ");
}

function getDiffLinesFromPatch(
  patches: Array<{ lines?: string[] }>,
): { type: "add" | "remove" | "context"; content: string }[] {
  const result: { type: "add" | "remove" | "context"; content: string }[] = [];

  for (const patch of patches) {
    if (!patch.lines) continue;
    for (const line of patch.lines) {
      if (line.startsWith("+")) {
        result.push({ type: "add", content: line.slice(1) });
      } else if (line.startsWith("-")) {
        result.push({ type: "remove", content: line.slice(1) });
      } else if (line.startsWith(" ")) {
        result.push({ type: "context", content: line.slice(1) });
      }
    }
  }

  return result;
}

export function mapToolStateToStepState(
  aiState: "partial-call" | "call" | "result",
): StepState {
  return aiState === "result" ? "complete" : "animating";
}

/** Think uses `file_path`; Flue workspace tools use `path`. */
export function filePathOf(
  args: Record<string, unknown> | undefined,
): string | undefined {
  if (!args) return undefined;
  const value = args.file_path ?? args.path;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function fileNameOf(
  args: Record<string, unknown> | undefined,
): string | undefined {
  const path = filePathOf(args);
  if (!path) return undefined;
  return path.split("/").pop() || path;
}

export function stringField(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function textOutput(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return stringField(record, "content", "output", "text", "stdout");
}

export function canonicalToolName(toolName: string): string {
  switch (toolName.toLowerCase()) {
    case "bash":
      return "Bash";
    case "edit":
      return "Edit";
    case "write":
      return "Write";
    case "read":
      return "Read";
    case "grep":
      return "Grep";
    case "glob":
      return "Glob";
    case "websearch":
    case "web_search":
      return "WebSearch";
    case "webfetch":
    case "web_fetch":
      return "WebFetch";
    case "planwrite":
      return "PlanWrite";
    case "todowrite":
      return "TodoWrite";
    default:
      return toolName;
  }
}

export function mapToolNameToVariant(
  toolName: string,
): "thinking" | "action" | "search" | undefined {
  const lower = toolName.toLowerCase();
  if (lower === "thinking" || lower === "reasoning") return "thinking";
  if (
    lower === "websearch" ||
    lower === "web_search" ||
    lower === "grep" ||
    lower === "glob" ||
    lower === "webfetch" ||
    lower === "web_fetch"
  )
    return "search";
  return undefined;
}

function extractToolDetail(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (canonicalToolName(toolName)) {
    case "Bash":
      return stringField(args, "command")?.slice(0, 80) ?? "";
    case "Edit":
    case "Write":
    case "Read":
      return fileNameOf(args) ?? "";
    case "Grep":
    case "Glob":
      return stringField(args, "pattern") ?? "";
    case "WebSearch":
      return stringField(args, "query") ?? "";
    case "WebFetch":
      return stringField(args, "url")?.slice(0, 60) ?? "";
    default:
      return fileNameOf(args) ?? "";
  }
}

export function mapToolInvocationToStep(
  toolCallId: string,
  toolInvocation: {
    toolName: string;
    args?: Record<string, any>;
    state: "partial-call" | "call" | "result";
    result?: any;
  },
): Extract<TimelineStep, { type: "tool-call" }> {
  const { toolName, args = {}, result } = toolInvocation;
  const canonical = canonicalToolName(toolName);
  const displayToolName =
    canonical === "PlanWrite"
      ? "Plan"
      : canonical === "TodoWrite"
        ? "Todo"
        : canonical;
  const detail = extractToolDetail(canonical, args);

  const step: Extract<TimelineStep, { type: "tool-call" }> = {
    id: toolCallId,
    type: "tool-call",
    toolName: displayToolName,
    toolDetail: detail,
    duration: Number.MAX_SAFE_INTEGER,
    toolVariant: mapToolNameToVariant(canonical),
  };

  if (canonical === "Bash") {
    step.bashCommand = stringField(args, "command");
    if (toolInvocation.state === "result" && result) {
      if (typeof result === "string") {
        step.bashOutput = result;
        step.bashSuccess = true;
      } else if (typeof result === "object") {
        const record = asRecord(result);
        const stdout = stringField(record, "stdout", "output") ?? "";
        const stderr = stringField(record, "stderr") ?? "";
        step.bashOutput = [stdout, stderr]
          .filter(Boolean)
          .join(stdout && stderr ? "\n" : "");
        const exitCode = record?.exitCode ?? record?.exit_code;
        step.bashSuccess = exitCode === undefined ? true : exitCode === 0;
      } else {
        step.bashOutput = JSON.stringify(result);
        step.bashSuccess = true;
      }
    }
  }

  if (canonical === "Edit" || canonical === "Write" || canonical === "Read") {
    step.filePath = filePathOf(args);
  }

  if (canonical === "Write") {
    const content =
      stringField(args, "content") ??
      (asRecord(result) ? textOutput(result) : undefined) ??
      "";

    if (content) {
      const lines = content.split("\n");
      step.diffStats = `+${lines.length}`;
      step.diffLines = lines.map((line: string) => ({
        type: "add",
        content: line,
      }));
    }
  }

  if (canonical === "Edit") {
    const record = asRecord(result);
    if (Array.isArray(record?.structuredPatch)) {
      step.diffStats = calculateDiffStatsFromPatch(
        record.structuredPatch as Array<{ lines?: string[] }>,
      );
      step.diffLines = getDiffLinesFromPatch(
        record.structuredPatch as Array<{ lines?: string[] }>,
      );
    } else {
      const oldText = stringField(args, "old_string", "oldText") ?? "";
      const newText = stringField(args, "new_string", "newText") ?? "";
      if (oldText || newText) {
        const oldLines = oldText.split("\n");
        const newLines = newText.split("\n");
        step.diffStats = `+${newLines.length} -${oldLines.length}`;
        step.diffLines = [
          ...oldLines.map((content) => ({
            type: "remove" as const,
            content,
          })),
          ...newLines.map((content) => ({
            type: "add" as const,
            content,
          })),
        ];
      }
    }
  }

  if (
    canonical === "WebSearch" ||
    canonical === "Grep" ||
    canonical === "Glob"
  ) {
    step.searchQuery = stringField(args, "query", "pattern");
    step.searchSource = canonical === "WebSearch" ? "web" : "code";
  }

  if (
    toolName.toLowerCase() === "thinking" ||
    toolName.toLowerCase() === "reasoning"
  ) {
    step.thoughtContent =
      typeof args?.thought === "string"
        ? args.thought
        : typeof result === "string"
          ? result
          : undefined;
  }

  return step;
}
