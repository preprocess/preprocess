import { Button } from "@preprocess/ui/components/button";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
} from "@preprocess/ui/lib/icons";
import { spring } from "@preprocess/ui/lib/springs";
import { typeClass } from "@preprocess/ui/lib/type-scale";
import { cn } from "@preprocess/ui/lib/utils";
import { motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

import { PageLink } from "./page-tree";
import { useAgentPrompt } from "@/lib/use-agent-prompt";

const medium = { fontVariationSettings: fontWeights.medium };

// The home page's opening: an eyebrow, the headline and the lede.
export function Hero({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <header>
      <p className={cn(typeClass("caption"), "text-muted-foreground")}>
        Overview
      </p>
      <h1
        className="mt-3 text-[32px] leading-[38px] tracking-[-0.03em] text-foreground sm:text-[48px] sm:leading-[56px]"
        data-page-title
        style={medium}
      >
        {title}
      </h1>
      <div className="mt-4 max-w-[700px] text-[15px] leading-6 text-muted-foreground sm:mt-5 sm:text-[17px] sm:leading-7">
        {children}
      </div>
    </header>
  );
}

// The one highlighted run of text on the page, as www sets it.
export function Highlight({ children }: { children: ReactNode }) {
  return <span className="docs-highlight">{children}</span>;
}

export function ArtCards({ children }: { children: ReactNode }) {
  return (
    <div className="mt-16 grid gap-8 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-10">
      {children}
    </div>
  );
}

const pearl = (alpha: number) => `rgb(251 247 240 / ${alpha})`;

// Hairline circles around one point, fading outwards.
function Rings({
  x,
  y,
  diameters,
  from,
  to,
}: {
  x: string;
  y: string;
  diameters: number[];
  from: number;
  to: number;
}) {
  return diameters.map((diameter, index) => (
    <span
      className="home-ring"
      key={diameter}
      style={{
        left: x,
        top: y,
        width: `${diameter}cqmin`,
        height: `${diameter}cqmin`,
        borderColor: pearl(
          from + ((to - from) * index) / (diameters.length - 1),
        ),
      }}
    />
  ));
}

const tiles = [
  { left: "20%", top: "30%" },
  { left: "80%", top: "40%" },
  { left: "72%", top: "80%" },
];

// An agent module wired to its tools.
function SdkArt() {
  return (
    <>
      <svg
        className="inset-0 size-full"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        {tiles.map(({ left, top }) => (
          <polyline
            fill="none"
            key={left}
            points={`50,52 ${parseFloat(left)},52 ${parseFloat(left)},${parseFloat(top)}`}
            stroke={pearl(0.28)}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {tiles.map((position) => (
        <span
          className="home-glass home-tile"
          key={position.left}
          style={position}
        />
      ))}
      <span className="home-glass home-module">
        <span className="home-core" />
      </span>
    </>
  );
}

// The command, with the cursor after it.
function CliArt() {
  return (
    <>
      <Rings
        diameters={[60, 72, 84, 96, 108, 120, 132, 144, 156, 168]}
        from={0.09}
        to={0.02}
        x="8cqw"
        y="110cqh"
      />
      <span className="home-command">
        <span className="home-prompt">$</span> preprocess deploy
        <span className="home-cursor" />
      </span>
    </>
  );
}

const orbRings = [18, 32, 46, 60, 74, 88];

// A client and a server, linked.
function McpArt() {
  return (
    <>
      <Rings diameters={orbRings} from={0.12} to={0.02} x="30%" y="58%" />
      <Rings diameters={orbRings} from={0.12} to={0.02} x="70%" y="58%" />
      <span className="home-link" />
      <span className="home-orb" style={{ left: "30%" }} />
      <span className="home-orb" style={{ left: "70%" }} />
    </>
  );
}

const endpoints = [
  ["GET", "/orgs/{org}/members"],
  ["GET", "/orgs/{org}/plan"],
  ["GET", "/orgs/{org}/audit-events/{id}"],
  ["DELETE", "/orgs/{org}/groups/{group}/members/{user}"],
  ["DELETE", "/orgs/{org}/agents/{agent}/grants/{group}"],
  ["GET", "/orgs/{org}/cases/{id}"],
];
const lit = 2;

// The endpoint index, one row lit.
function ApiArt() {
  return (
    <>
      <div className="home-endpoints">
        {endpoints.map(([method, path], index) => (
          <div
            className={cn(
              "home-endpoint",
              index === lit && "home-endpoint-lit",
            )}
            key={path}
            style={
              {
                "--row":
                  index === lit
                    ? 0.95
                    : Math.max(0.12, 0.5 - 0.14 * Math.abs(index - lit)),
              } as CSSProperties
            }
          >
            <span className="home-method">{method}</span>
            {path}
          </div>
        ))}
      </div>
      <span className="home-crop" />
    </>
  );
}

const arts = { sdk: SdkArt, cli: CliArt, mcp: McpArt, api: ApiArt };

// A link to one of the four tools: its slate art, then its title, what it
// covers and, optionally, the command that starts it.
export function ArtCard({
  title,
  description,
  href,
  art,
  hint,
}: {
  title: string;
  description: string;
  href: string;
  art: keyof typeof arts;
  hint?: string;
}) {
  const Art = arts[art];
  return (
    <motion.div animate="rest" initial="rest" whileHover="hover">
      <PageLink className="flex flex-col gap-4" url={href}>
        <div aria-hidden className="home-art">
          <Art />
        </div>
        <span className="flex flex-col gap-1 px-1">
          <span className="flex items-center gap-2">
            <span
              className={cn(typeClass("subtitle"), "flex-1 text-foreground")}
              style={medium}
            >
              {title}
            </span>
            <motion.span
              className="text-muted-foreground"
              transition={spring.fast}
              variants={{ rest: { x: 0 }, hover: { x: 2 } }}
            >
              <ChevronRight size={16} />
            </motion.span>
          </span>
          <span className={cn(typeClass("caption"), "text-muted-foreground")}>
            {description}
          </span>
          {hint ? (
            <span className="mt-1 truncate font-mono text-[12px] leading-4 text-muted-foreground">
              {hint}
            </span>
          ) : null}
        </span>
      </PageLink>
    </motion.div>
  );
}

// A numbered path of steps, each with its code beside it.
export function Steps({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-14 sm:mt-22">
      <h2
        className={cn(typeClass("title"), "text-foreground")}
        id="deploy-your-first-agent"
        style={medium}
      >
        {title}
      </h2>
      <p className={cn(typeClass("body"), "mt-1 text-muted-foreground")}>
        {description}
      </p>
      <ol className="home-steps mt-7">{children}</ol>
    </section>
  );
}

export function Step({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <li className="home-step grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 sm:grid-cols-[28px_250px_minmax(0,1fr)] sm:gap-x-5">
      <span className="home-step-number" style={medium} />
      <div className="pt-0.5">
        <p
          className={cn(typeClass("subtitle"), "text-foreground")}
          style={medium}
        >
          {title}
        </p>
        <p className={cn(typeClass("caption"), "mt-1 text-muted-foreground")}>
          {description}
        </p>
      </div>
      <div className="col-start-2 mt-3.5 min-w-0 sm:col-start-3 sm:mt-0">
        {children}
      </div>
    </li>
  );
}

// The SDK prompt for a coding agent, offered whole with one button.
export function PromptBlock({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const prompt = useAgentPrompt("sdk");
  return (
    <section className="mt-14 rounded-3xl bg-surface-3 p-5 shadow-[inset_0_0_0_1px_var(--border)] sm:mt-22 sm:p-7">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
        <div>
          <h2
            className={cn(typeClass("title"), "text-foreground")}
            style={medium}
          >
            {title}
          </h2>
          <p className={cn(typeClass("body"), "mt-1 text-muted-foreground")}>
            {description}
          </p>
        </div>
        <Button
          className="docs-app-step shrink-0"
          leadingIcon={prompt.copied ? Check : Copy}
          onClick={() => void prompt.copy()}
          variant="primary"
        >
          {prompt.copied ? "Copied" : "Copy prompt"}
        </Button>
      </div>
      <div className="mt-5 overflow-hidden rounded-2xl bg-surface-2 shadow-[inset_0_0_0_1px_var(--border)]">
        <div
          className={cn(
            typeClass("caption"),
            "docs-app-step flex h-10 items-center justify-between px-4 text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]",
          )}
        >
          <span className="truncate">{prompt.title}</span>
          <span>Markdown</span>
        </div>
        <div className="relative">
          <pre
            className={cn(
              "overflow-hidden px-4 pt-3.5 font-mono text-[12px] leading-5 whitespace-pre-wrap text-foreground",
              prompt.expanded ? "pb-2" : "max-h-[190px]",
            )}
          >
            {prompt.text}
          </pre>
          {prompt.expanded ? null : (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-surface-2" />
          )}
          <div
            className={cn(
              "flex justify-center",
              prompt.expanded ? "pb-4" : "absolute inset-x-0 bottom-3.5",
            )}
          >
            <Button
              className={cn(
                "docs-app-step",
                prompt.expanded && "[&_svg]:rotate-180",
              )}
              onClick={() => prompt.setExpanded(!prompt.expanded)}
              size="compact"
              trailingIcon={ChevronDown}
              variant="secondary"
            >
              {prompt.expanded ? "Collapse prompt" : "Expand prompt"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
