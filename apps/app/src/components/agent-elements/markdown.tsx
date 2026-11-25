"use client";

import { Streamdown, type AnimateOptions, type Components } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { cn } from "./utils/cn";

/**
 * Only newly-mounted word spans animate (Streamdown reconciliation).
 * Hoisted so Streamdown's memo does not reset. Stagger stays 0 — Flue
 * withholds later text, so a batch fade would light up every new line.
 */
const streamAnimation: AnimateOptions = {
  animation: "fadeIn",
  duration: 150,
  easing: "ease-out",
  sep: "word",
  stagger: 0,
};

function fixNumberedListBreaks(text: string): string {
  return text.replace(/^(\d+)\.\s*\n+\s*\n*/gm, "$1. ");
}

const CODE_FENCE_LANGS = new Set([
  "bash",
  "diff",
  "html",
  "js",
  "json",
  "jsx",
  "md",
  "markdown",
  "sh",
  "shell",
  "text",
  "ts",
  "tsx",
  "yml",
  "yaml",
]);

function normalizeCodeFenceLanguages(text: string): string {
  return text.replace(/```([^\n]*)/g, (_match, langRaw) => {
    const lang = String(langRaw || "")
      .trim()
      .toLowerCase();
    if (!lang) return "```";
    const normalized = lang.split(/\s+/)[0];
    return CODE_FENCE_LANGS.has(normalized) ? `\`\`\`${normalized}` : "```text";
  });
}

export type MarkdownProps = {
  content: string;
  className?: string;
  /** True while assistant text is still streaming into this block. */
  isAnimating?: boolean;
};

const code = createCodePlugin({
  themes: ["github-light", "github-dark"],
});

// Hoisted so Streamdown can memoize blocks across streaming updates.
const markdownComponents: Components = {
  h1: ({ children, ...props }) => (
    <h1
      className="an-md-h1 text-subtitle mt-3 mb-1.5"
      style={{ fontVariationSettings: fontWeights.medium }}
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2
      className="an-md-h2 text-subtitle mt-3 mb-1.5"
      style={{ fontVariationSettings: fontWeights.medium }}
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3
      className="an-md-h3 text-body mt-2 mb-1"
      style={{ fontVariationSettings: fontWeights.medium }}
      {...props}
    >
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="an-md-h4 text-body font-medium mt-2 mb-1" {...props}>
      {children}
    </h4>
  ),
  h5: ({ children, ...props }) => (
    <h5 className="an-md-h5 text-body font-medium mt-2 mb-1" {...props}>
      {children}
    </h5>
  ),
  h6: ({ children, ...props }) => (
    <h6 className="an-md-h6 text-caption font-medium mt-2 mb-1" {...props}>
      {children}
    </h6>
  ),
  p: ({ children, ...props }) => (
    <p
      className="an-md-p text-body leading-relaxed text-an-foreground/80"
      {...props}
    >
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul
      className="an-md-ul list-disc list-outside space-y-0.5 text-body mb-2 pl-4 text-an-foreground/80"
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol
      className="an-md-ol list-decimal list-outside space-y-0.5 text-body mb-2 pl-5 text-an-foreground/80"
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="an-md-li text-body pl-0.5 text-an-foreground/80" {...props}>
      {children}
    </li>
  ),
  // Streamdown's default image renderer uses a block wrapper for controls.
  // Markdown images are phrasing content and are commonly emitted inside a
  // paragraph, so use an inline renderer to keep the HTML valid for hydration.
  img: ({ alt, ...props }) => (
    <img
      {...props}
      alt={alt ?? ""}
      className="my-2 max-w-full rounded-lg"
      loading="lazy"
    />
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-medium text-an-foreground" {...props}>
      {children}
    </strong>
  ),
  a: ({ href, children, ...props }) => {
    if (!href) return <span>{children}</span>;
    const isExternal = href.startsWith("http") || href.startsWith("mailto:");
    return (
      <a
        {...props}
        href={href}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
        className="an-md-link hover:underline underline-offset-2 text-an-primary-color"
      >
        {children}
      </a>
    );
  },
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="an-md-blockquote pl-3 italic mb-2 text-body border-l-2 border-an-border-color text-an-foreground/70"
      {...props}
    >
      {children}
    </blockquote>
  ),
  hr: ({ ...props }) => (
    <hr className="an-md-hr my-4 border-an-border-color" {...props} />
  ),
  table: ({ children, ...props }) => (
    <ScrollArea
      orientation="horizontal"
      // A filled card like the chat bubbles: surface, radius, and hairlines
      // only between rows, never an outline.
      className="my-3 rounded-xl bg-surface-3"
    >
      <table className="an-md-table w-full text-body" {...props}>
        {children}
      </table>
    </ScrollArea>
  ),
  th: ({ children, ...props }) => (
    <th
      className="px-3 py-2 text-left text-caption text-muted-foreground"
      style={{ fontVariationSettings: fontWeights.medium }}
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td
      className="border-t border-border/60 px-3 py-2 text-foreground"
      {...props}
    >
      {children}
    </td>
  ),
};

const codePlugins = { code: code as never };

export function Markdown({
  content,
  className,
  isAnimating = false,
}: MarkdownProps) {
  const safeContent = normalizeCodeFenceLanguages(
    fixNumberedListBreaks(content),
  );

  return (
    <div
      className={cn(
        "an-markdown",
        "wrap-break-word",
        "[&_li>p]:inline [&_li>p]:mb-0",
        className,
      )}
    >
      <Streamdown
        animated={streamAnimation}
        components={markdownComponents}
        // @streamdown/code and streamdown ship mismatched HighlightOptions.
        plugins={codePlugins}
        mode={isAnimating ? "streaming" : "static"}
        isAnimating={isAnimating}
        caret={isAnimating ? "block" : undefined}
      >
        {safeContent}
      </Streamdown>
    </div>
  );
}
