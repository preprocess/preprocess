import { Button } from "@preprocess/ui/components/button";
import {
  TabItem,
  TabPanel,
  Tabs as FluidTabs,
  TabsList,
} from "@preprocess/ui/components/tabs";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  InfoIcon,
  Lightbulb,
  OctagonAlert,
  OrbitSparkle,
  Plug,
  Terminal,
  TriangleAlertIcon,
} from "@preprocess/ui/lib/icons";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { use, useState, type ReactNode } from "react";

import { Pre } from "./code-block";
import { ApiUrlContext, Configured, configure } from "./configured";
import {
  contains,
  firstPage,
  folderPages,
  PageLink,
  splitTree,
  textOf,
  TreeContext,
} from "./page-tree";
import { agentPrompts } from "@/lib/prompts";

function Cards({ children }: { children: ReactNode }) {
  return (
    <div className="not-typeset grid gap-3 sm:grid-cols-2">{children}</div>
  );
}

const cardIcons = {
  braces: Braces,
  code: Code,
  plug: Plug,
  terminal: Terminal,
};

// A link to another page: an icon tile, the title, what it covers and,
// optionally, the command that starts it.
function Card({
  title,
  description,
  href,
  icon,
  hint,
}: {
  title: string;
  description?: string;
  href: string;
  icon?: keyof typeof cardIcons;
  hint?: string;
}) {
  const Icon = icon ? cardIcons[icon] : undefined;
  return (
    <PageLink
      className="relative flex flex-col gap-4 rounded-3xl bg-surface-1 p-5 shadow-[inset_0_0_0_1px_var(--border)] transition-colors duration-80 hover:bg-surface-3"
      url={href}
    >
      <ChevronRight
        className="absolute top-5 right-5 text-muted-foreground"
        size={16}
      />
      {Icon ? (
        <span className="flex size-9 items-center justify-center rounded-xl bg-surface-2 text-foreground shadow-surface-2">
          <Icon size={18} />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-col gap-1">
        <span
          className={cn(typeClass("subtitle"), "text-foreground")}
          style={{ fontVariationSettings: fontWeights.medium }}
        >
          {title}
        </span>
        {description ? (
          <span className={cn(typeClass("caption"), "text-muted-foreground")}>
            {description}
          </span>
        ) : null}
        {hint ? (
          <span
            className={cn(
              typeClass("caption", "compact"),
              "docs-app-step mt-2 truncate font-mono text-muted-foreground",
            )}
          >
            {hint}
          </span>
        ) : null}
      </span>
    </PageLink>
  );
}

const callouts = {
  note: {
    icon: InfoIcon,
    className: "bg-surface-3",
    tone: "text-muted-foreground",
  },
  tip: {
    icon: Lightbulb,
    className: "bg-[color-mix(in_oklab,var(--success)_12%,transparent)]",
    tone: "text-success",
  },
  warning: {
    icon: TriangleAlertIcon,
    className: "bg-[color-mix(in_oklab,var(--warning)_12%,transparent)]",
    tone: "text-warning",
  },
  danger: {
    icon: OctagonAlert,
    className: "bg-[color-mix(in_oklab,var(--destructive)_9%,transparent)]",
    tone: "text-destructive",
  },
};

// An aside: one tinted box, its kind told by the fill and the icon.
function Callout({
  title = "Note",
  type = "note",
  children,
}: {
  title?: ReactNode;
  type?: keyof typeof callouts;
  children: ReactNode;
}) {
  const { icon: Icon, className, tone } = callouts[type];
  return (
    <div
      className={cn(
        "not-typeset flex gap-3 rounded-2xl pt-3.5 pr-4.5 pb-4 pl-4",
        className,
      )}
    >
      <span className="flex h-[var(--lh-body)] shrink-0 items-center">
        <Icon className={tone} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(typeClass("body"), "text-foreground")}
          style={{ fontVariationSettings: fontWeights.medium }}
        >
          {title}
        </p>
        <div className="typeset docs-prose">{children}</div>
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
    <div className="not-typeset docs-app-step overflow-hidden rounded-2xl bg-surface-1 shadow-[inset_0_0_0_1px_var(--border)]">
      <div className="flex h-12 items-center gap-2 pr-2.5 pl-4 shadow-[inset_0_-1px_0_var(--border)]">
        <OrbitSparkle className="shrink-0 text-muted-foreground" size={16} />
        <span
          className={cn(
            typeClass("subtitle"),
            "min-w-0 flex-1 truncate text-foreground",
          )}
          style={{ fontVariationSettings: fontWeights.medium }}
        >
          {title}
        </span>
        <Button
          className="hidden sm:inline-flex"
          leadingIcon={copied ? Check : Copy}
          onClick={() => void copy()}
          size="compact"
          variant="secondary"
        >
          {copied ? "Copied" : "Copy prompt"}
        </Button>
        <Button
          aria-label="Copy prompt"
          className="size-7 rounded-full sm:hidden"
          onClick={() => void copy()}
          size="icon"
          variant="secondary"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </Button>
      </div>
      <div className="relative">
        <pre
          className={cn(
            "docs-code overflow-hidden px-4 pt-3.5 pb-0 font-mono whitespace-pre-wrap text-muted-foreground",
            !expanded && "max-h-[132px] sm:max-h-[150px]",
          )}
        >
          {text}
        </pre>
        {expanded ? null : (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-surface-1/70 sm:h-[88px]" />
        )}
      </div>
      <div className="flex h-11 items-center justify-center">
        <Button
          className={expanded ? "[&_svg]:rotate-180" : undefined}
          leadingIcon={ChevronDown}
          onClick={() => setExpanded(!expanded)}
          size="compact"
          variant="ghost"
        >
          {expanded ? "Collapse prompt" : "Expand prompt"}
        </Button>
      </div>
    </div>
  );
}

// The reference index's tags: each links to its first operation.
function EndpointTags() {
  const tree = use(TreeContext);
  const root = tree
    ? splitTree(tree).reference.find((folder) => contains(folder, "/api"))
    : undefined;
  if (!root) return null;
  return (
    <div className="not-typeset grid gap-3 sm:grid-cols-2">
      {root.children.map((tag, index) => {
        if (tag.type !== "folder") return null;
        const url = firstPage(tag);
        const count = folderPages(tag).length;
        if (!url) return null;
        return (
          <PageLink
            className="flex h-13 items-center gap-3 rounded-2xl pr-3.5 pl-4 shadow-[inset_0_0_0_1px_var(--border)] transition-colors duration-80 hover:bg-hover"
            key={index}
            url={url}
          >
            <span
              className={cn(
                typeClass("body"),
                "min-w-0 flex-1 truncate text-foreground",
              )}
              style={{ fontVariationSettings: fontWeights.medium }}
            >
              {textOf(tag.name)}
            </span>
            <span
              className={cn(
                typeClass("caption"),
                "docs-app-step shrink-0 text-muted-foreground",
              )}
            >
              {count === 1 ? "1 endpoint" : `${count} endpoints`}
            </span>
            <ChevronRight
              className="shrink-0 text-muted-foreground"
              size={14}
            />
          </PageLink>
        );
      })}
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
    EndpointTags,
    ...components,
  }) satisfies MDXComponents;

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
