import { Button } from "@preprocess/ui/components/button";
import { Check, Copy, FileText } from "@preprocess/ui/lib/icons";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";
import {
  CodeBlock,
  Pre as FumadocsPre,
} from "fumadocs-ui/components/codeblock";
import { useState, type ComponentProps } from "react";

const languages: Record<string, string> = {
  js: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  sh: "Shell",
  ts: "TypeScript",
  tsx: "TSX",
  yaml: "YAML",
};

function CopyCode({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      aria-label={copied ? "Copied" : "Copy code"}
      className={cn("size-7", className)}
      onClick={(event) => {
        const text = event.currentTarget
          .closest("figure")
          ?.querySelector("pre")?.textContent;
        if (!text) return;
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      size="icon-compact"
      variant="ghost"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  );
}

// Code blocks keep Fumadocs' highlighting as a recessed well: a header with
// the file and its language when titled, and the copy button either way.
// They sit outside the typeset, which would otherwise draw its own block.
export function Pre({ title, ...props }: ComponentProps<"pre">) {
  const language = title
    ? languages[title.split(".").pop()?.toLowerCase() ?? ""]
    : undefined;
  return (
    <div className="not-typeset">
      <CodeBlock
        Actions={() =>
          title ? (
            <div className="flex shrink-0 items-center gap-2">
              {language ? (
                <span className={cn(typeClass("caption"), "docs-app-step")}>
                  {language}
                </span>
              ) : null}
              <CopyCode />
            </div>
          ) : (
            <div className="absolute top-0 right-1.5 z-2 flex h-12 items-center">
              <CopyCode className="bg-surface-1" />
            </div>
          )
        }
        allowCopy={false}
        className="docs-codeblock my-0 rounded-2xl border-0 bg-surface-1 shadow-[inset_0_0_0_1px_var(--border)]"
        icon={title ? <FileText className="shrink-0" size={14} /> : undefined}
        title={title}
        viewportProps={{
          className: title ? "pt-3.5 pb-4" : "py-3.25 pr-12",
        }}
      >
        <FumadocsPre {...props} />
      </CodeBlock>
    </div>
  );
}
