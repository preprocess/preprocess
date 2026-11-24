import React, { memo } from "react";

import { QuestionTool } from "../question/question-tool";
import type { CustomToolRendererProps } from "../types";
import { getToolStatus } from "../utils/format-tool";
import { BashTool } from "./bash-tool";
import { EditTool } from "./edit-tool";
import { GenericTool } from "./generic-tool";
import { McpTool, unwrapMcpOutput } from "./mcp-tool";
import { PlanTool } from "./plan-tool";
import { ReadTool } from "./read-tool";
import { SearchTool } from "./search-tool";
import { ThinkingTool } from "./thinking-tool";
import { TodoTool } from "./todo-tool";
import { ToolGroup } from "./tool-group";
import { parseMcpToolType, toolRegistry } from "./tool-registry";

export type ToolRendererProps = {
  /** AI SDK `tool-*` part (or dynamic tool with `toolName`). */
  part: any;
  nestedTools?: any[];
  chatStatus?: string;
  toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>;
};

function deriveToolStatus(
  part: any,
  chatStatus?: string,
): CustomToolRendererProps["status"] {
  if (part.state === "input-streaming") return "streaming";
  if (part.state === "input-available") return "pending";
  if (part.state === "output-available") return "success";
  if (part.state === "output-error") return "error";
  const { isPending } = getToolStatus(part, chatStatus);
  return isPending ? "pending" : "success";
}

function toolNameOf(part: any): string {
  if (typeof part.toolName === "string" && part.toolName) return part.toolName;
  const partType = String(part.type ?? "");
  if (partType.startsWith("tool-")) return partType.slice("tool-".length);
  return partType;
}

export const ToolRenderer = memo(function ToolRenderer({
  part,
  nestedTools,
  chatStatus,
  toolRenderers,
}: ToolRendererProps) {
  const partType = part.type as string;
  const toolName = toolNameOf(part);
  const normalizedName = toolName.toLowerCase();

  // Prefer toolName / stripped tool-* name (case-insensitive).
  switch (normalizedName) {
    case "bash":
      return <BashTool part={part} />;
    case "read":
      return <ReadTool part={part} />;
    case "edit":
    case "write":
      return <EditTool part={part} />;
    case "websearch":
    case "grep":
    case "glob":
      return <SearchTool part={part} />;
    case "planwrite":
      return <PlanTool part={part} chatStatus={chatStatus} />;
    case "todowrite":
      return <TodoTool part={part} chatStatus={chatStatus} />;
    case "question":
      return <QuestionTool part={part} chatStatus={chatStatus} />;
    case "task":
    case "agent": {
      const labelBase = normalizedName === "agent" ? "Agent" : "Task";
      return (
        <ToolGroup
          part={part}
          nestedTools={nestedTools}
          chatStatus={chatStatus}
          completeLabel={`${labelBase} completed`}
          shimmerLabel={`Running ${labelBase.toLowerCase()}`}
          interruptedLabel={`${labelBase} interrupted`}
          defaultOpen={false}
        />
      );
    }
    case "thinking":
      return <ThinkingTool part={part} />;
  }

  // Legacy AI SDK tool-* types (exact casing).
  switch (partType) {
    case "tool-Bash":
      return <BashTool part={part} />;
    case "tool-Read":
      return <ReadTool part={part} />;
    case "tool-Edit":
    case "tool-Write":
      return <EditTool part={part} />;
    case "tool-WebSearch":
    case "tool-Grep":
    case "tool-Glob":
      return <SearchTool part={part} />;
    case "tool-PlanWrite":
      return <PlanTool part={part} chatStatus={chatStatus} />;
    case "tool-TodoWrite":
      return <TodoTool part={part} chatStatus={chatStatus} />;
    case "tool-Question":
      return <QuestionTool part={part} chatStatus={chatStatus} />;
    case "tool-Task":
    case "tool-Agent": {
      const labelBase = partType === "tool-Agent" ? "Agent" : "Task";
      return (
        <ToolGroup
          part={part}
          nestedTools={nestedTools}
          chatStatus={chatStatus}
          completeLabel={`${labelBase} completed`}
          shimmerLabel={`Running ${labelBase.toLowerCase()}`}
          interruptedLabel={`${labelBase} interrupted`}
          defaultOpen={false}
        />
      );
    }
    case "tool-Thinking":
      return <ThinkingTool part={part} />;
  }

  const mcpLookupType = partType.startsWith("tool-")
    ? partType
    : `tool-${toolName}`;
  const mcpInfo = parseMcpToolType(mcpLookupType);
  if (mcpInfo) {
    if (toolRenderers && mcpInfo.serverName === "user-tools") {
      const CustomRenderer = toolRenderers[mcpInfo.toolName];
      if (CustomRenderer) {
        return (
          <CustomRenderer
            name={mcpInfo.toolName}
            input={(part.input ?? {}) as Record<string, unknown>}
            output={part.output ? unwrapMcpOutput(part.output) : undefined}
            status={deriveToolStatus(part, chatStatus)}
          />
        );
      }
    }
    return <McpTool part={part} mcpInfo={mcpInfo} chatStatus={chatStatus} />;
  }

  const titled = `${toolName.charAt(0).toUpperCase()}${toolName.slice(1)}`;
  const meta =
    toolRegistry[partType] ??
    toolRegistry[`tool-${toolName}`] ??
    toolRegistry[`tool-${titled}`];
  if (meta) {
    const { isPending, isError } = getToolStatus(part, chatStatus);
    return (
      <GenericTool
        title={meta.title(part)}
        subtitle={meta.subtitle?.(part)}
        isPending={isPending}
        isError={isError}
      />
    );
  }

  const { isPending, isError } = getToolStatus(part, chatStatus);
  return (
    <GenericTool
      title={isPending ? `Running ${toolName}` : toolName}
      isPending={isPending}
      isError={isError}
    />
  );
});
