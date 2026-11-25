import { Button } from "@preprocess/ui/components/button";
import {
  TabItem,
  TabPanel,
  Tabs as FluidTabs,
  TabsList,
} from "@preprocess/ui/components/tabs";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  InfoIcon,
  OrbitSparkle,
} from "@preprocess/ui/lib/icons";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { use, useState, type ComponentProps, type ReactNode } from "react";

import { ApiUrlContext, Configured, configure } from "./configured";
import { PageLink } from "./docs-shell";
import { agentPrompts } from "@/lib/prompts";

// Code blocks keep Fumadocs' highlighting and copy button but sit outside
// the typeset, which would otherwise draw its own block behind them.
function Pre(props: ComponentProps<"pre">) {
  const CodeBlock = defaultMdxComponents.pre;
  return (
    <div className="not-typeset">
      <CodeBlock {...props} />
    </div>
  );
}

function Cards({ children }: { children: ReactNode }) {
  return (
    <div className="not-typeset grid gap-3 sm:grid-cols-2">{children}</div>
  );
}

// A link to another page, drawn as a bordered card with a chevron.
function Card({
  title,
  description,
  href,
}: {
  title: string;
  description?: string;
  href: string;
}) {
  return (
    <PageLink
      className="flex items-center gap-4 rounded-2xl border border-border px-5 py-4 transition-colors hover:bg-hover"
      url={href}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={cn(typeClass("subtitle"), "text-foreground")}
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {title}
        </span>
        {description ? (
          <span className={cn(typeClass("body"), "text-muted-foreground")}>
            {description}
          </span>
        ) : null}
      </span>
      <ChevronRight className="shrink-0 text-muted-foreground" size={16} />
    </PageLink>
  );
}

// An aside: a bordered card with a rule down its left edge.
function Callout({
  title = "Note",
  children,
}: {
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="not-typeset rounded-2xl border border-border p-1.5">
      <div className="border-l-2 border-border py-2 pr-3 pl-4">
        <p
          className={cn(
            typeClass("subtitle"),
            "flex items-center gap-2 text-foreground",
          )}
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          <InfoIcon className="shrink-0 text-muted-foreground" size={16} />
          {title}
        </p>
        <div className="typeset docs-prose mt-1">{children}</div>
      </div>
    </div>
  );
}

// A prompt to hand to a coding agent: copied whole, shown folded until
// expanded.
function AgentPrompt({ name }: { name: keyof typeof agentPrompts }) {
  const { title, prompt } = agentPrompts[name];
  const text = configure(prompt, use(ApiUrlContext));
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="not-typeset overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border py-2 pr-2 pl-4">
        <OrbitSparkle className="shrink-0 text-muted-foreground" size={16} />
        <span
          className={cn(typeClass("subtitle"), "flex-1 text-foreground")}
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {title}
        </span>
        <Button
          leadingIcon={copied ? Check : Copy}
          onClick={() => void copy()}
          size="compact"
        >
          {copied ? "Copied" : "Copy prompt"}
        </Button>
      </div>
      <div className="relative">
        <pre
          className={cn(
            typeClass("body"),
            "overflow-hidden px-4 py-3 font-mono whitespace-pre-wrap text-muted-foreground",
            !expanded && "max-h-48",
          )}
        >
          {text}
        </pre>
        <div
          className={cn(
            "flex justify-center pb-3",
            !expanded &&
              "absolute inset-x-0 bottom-0 bg-gradient-to-t from-card via-card to-transparent pt-12",
          )}
        >
          <Button
            leadingIcon={ChevronDown}
            onClick={() => setExpanded(!expanded)}
            size="compact"
            variant="secondary"
            className={expanded ? "[&_svg]:rotate-180" : undefined}
          >
            {expanded ? "Collapse prompt" : "Expand prompt"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Tabs({ items, children }: { items: string[]; children: ReactNode }) {
  return (
    <FluidTabs className="not-typeset" defaultValue={items[0]}>
      <TabsList>
        {items.map((item) => (
          <TabItem key={item} label={item} value={item} />
        ))}
      </TabsList>
      {children}
    </FluidTabs>
  );
}

function Tab({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabPanel className="mt-3" value={value}>
      {children}
    </TabPanel>
  );
}

export const getMDXComponents = (components?: MDXComponents) =>
  ({
    ...defaultMdxComponents,
    pre: Pre,
    AgentPrompt,
    Callout,
    Card,
    Cards,
    Tab,
    Tabs,
    Configured,
    ...components,
  }) satisfies MDXComponents;

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
