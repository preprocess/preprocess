import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { Elevated } from "@preprocess/ui/lib/elevated";
import { memo } from "react";

import { FileExtIcon } from "../icons/file-ext-icon";
import { TextShimmer } from "../text-shimmer";
import { fileNameOf, filePathOf, textOutput } from "../utils/tool-adapters";

export type ReadToolProps = {
  part: {
    id?: string;
    toolCallId?: string;
    type?: string;
    toolName?: string;
    state?: string;
    input?: Record<string, unknown>;
    args?: Record<string, unknown>;
    output?: unknown;
    result?: unknown;
  };
};

export const ReadTool = memo(function ReadTool({ part }: ReadToolProps) {
  const args = part.input ?? part.args ?? {};
  const fileName = fileNameOf(args) ?? "file";
  const path = filePathOf(args);
  const content = textOutput(part.output ?? part.result);
  const isPending =
    part.state !== "output-available" && part.state !== "output-error";

  return (
    <Elevated
      offset={2}
      className="overflow-hidden rounded-an-tool-border-radius"
    >
      <div className="flex h-7 items-center gap-1.5 px-2.5">
        <FileExtIcon filename={fileName} className="size-3 shrink-0" />
        {isPending ? (
          <TextShimmer as="span" duration={1.2} className="text-caption">
            Reading {fileName}
          </TextShimmer>
        ) : (
          <span className="truncate text-caption text-muted-foreground">
            Read {path ?? fileName}
          </span>
        )}
      </div>
      {!isPending && content != null ? (
        <ScrollArea
          className="border-t border-border bg-background"
          viewportClassName="scroll-fade max-h-[160px]"
        >
          <div className="px-2.5 py-1.5 font-mono text-caption leading-[16px] whitespace-pre-wrap text-muted-foreground">
            {content}
          </div>
        </ScrollArea>
      ) : null}
    </Elevated>
  );
});
