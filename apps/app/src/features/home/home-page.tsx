import { badgeColors } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  Card,
  CardDescription,
  CardTitle,
} from "@preprocess/ui/components/card";
import { EmptyMedia } from "@preprocess/ui/components/empty";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { Skeleton } from "@preprocess/ui/components/skeleton";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import type { IconComponent } from "@preprocess/ui/lib/icon-context";
import {
  ChevronRight,
  Coins,
  Folder4,
  Gauge,
  Inbox,
  OrbitSparkle,
  Users,
  X,
} from "@preprocess/ui/lib/icons";
import { spring } from "@preprocess/ui/lib/springs";
import { cn } from "@preprocess/ui/lib/utils";
import { useRouter } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";

import {
  AgentsArt,
  CasesArt,
  InboxListArt,
  LogsArt,
} from "../../components/empty-art";
import { CaseStatusIcon } from "../agent-cases/case-status-icon";
import type { CaseStatus } from "../agent-cases/case";
import { AssigneeStack } from "../agent-cases/assignee-stack";
import { useOrganizationId } from "../auth/auth-context";
import { useBilling, useBillingUsage } from "../billing/billing-api";
import {
  creditsUsd,
  nextMonthStart,
  shortDate,
  usd,
} from "../billing/billing-format";
import { billingShown, type Billing } from "../billing/billing-types";
import type { InboxItem } from "../inbox/notification";
import { captureProductEvent } from "../monitoring/posthog";
import { dismissHomeCard, type HomeData, type HomeLoad } from "./home-api";
import { homeCards, MAX_CARDS, type HomeCardView } from "./home-cards";

// The home page (PRE-178, Design's notes from PLAT-44): a greeting, up to
// four action cards, and live previews of the pages this person uses. Every
// block is something to do or a page to open.

type Tile =
  "inbox" | "cases" | "agents" | "observability" | "billing" | "members";

const SECTION_LABEL = "text-caption text-muted-foreground";

const medium = { fontVariationSettings: fontWeights.medium };

export function HomePage({
  load,
  firstName,
}: Readonly<{ load: HomeLoad; firstName: string | null }>) {
  const { home, waiting } = load;
  const organizationId = useOrganizationId();
  const owner = home.roles.owner;
  const billing = useBilling();
  const usage = useBillingUsage(owner);
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const billingData = owner ? billing.data : null;
  const all = homeCards(home, waiting, billingData, origin).filter(
    (card) => !dismissed.includes(card.id),
  );
  const shown = all.slice(0, MAX_CARDS);
  const isNew = all.some((card) => card.dismiss !== null);
  const greeting = `${isNew ? "Welcome" : "Welcome back"}${firstName ? `, ${firstName}` : ""}`;

  const dismiss = (card: HomeCardView) => {
    if (!card.dismiss) return;
    captureProductEvent("home_card_dismissed", { card: card.name });
    setDismissed((ids) => [...ids, card.id]);
    void dismissHomeCard(organizationId, card.dismiss).catch(() =>
      setDismissed((ids) => ids.filter((id) => id !== card.id)),
    );
  };

  const tiles = homeTiles(
    home,
    waiting,
    owner &&
      (billing.isPending || (!!billing.data && billingShown(billing.data))),
  );

  return (
    <HomeFrame>
      <h1
        className="text-display tracking-[-0.03em] text-foreground"
        style={medium}
      >
        {greeting}
      </h1>
      {shown.length > 0 || (owner && billing.isPending) ? (
        <section aria-labelledby="home-todo" className="flex flex-col gap-3">
          <h2 className={SECTION_LABEL} id="home-todo">
            To do
          </h2>
          <div className={CARD_GRID}>
            <AnimatePresence initial={false} mode="popLayout">
              {shown.map((card, position) => (
                <motion.div
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex"
                  exit={{ opacity: 0, scale: 0.97 }}
                  initial={{ opacity: 0, scale: 0.97 }}
                  key={card.id}
                  layout
                  transition={spring.moderate}
                >
                  <ActionCard
                    card={card}
                    onDismiss={() => dismiss(card)}
                    onUse={() =>
                      captureProductEvent("home_card_clicked", {
                        card: card.name,
                        position,
                      })
                    }
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      ) : null}
      {tiles.length > 0 ? (
        <section aria-label="Previews" className={TILE_GRID}>
          {tiles.map((tile) => (
            <PreviewTile
              billing={billingData ?? null}
              billingPending={owner && (billing.isPending || usage.isPending)}
              home={home}
              key={tile}
              nextInvoice={usage.data ? nextMonthStart(usage.data.month) : null}
              spentUsd={usage.data?.paidFromCreditsUsd ?? 0}
              tile={tile}
              waiting={waiting}
            />
          ))}
        </section>
      ) : null}
    </HomeFrame>
  );
}

/**
 * An in-app link to a path the cards and tiles compute: a plain anchor, so
 * middle-click and "open in new tab" work, that navigates in place.
 */
function AppLink({
  href,
  onClick,
  ...props
}: Readonly<React.ComponentProps<"a"> & { href: string }>) {
  const router = useRouter();
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        router.history.push(href);
      }}
    />
  );
}

const CARD_GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4";
const TILE_GRID = "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3";

function HomeFrame({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ScrollArea
      className="min-h-0 flex-1"
      viewportClassName="scroll-fade overscroll-none"
    >
      <div className="mx-auto flex w-full max-w-[72rem] flex-col gap-10 px-6 py-8">
        {children}
      </div>
    </ScrollArea>
  );
}

// Waiting on them, then the pages they use (spec: Previews).
function homeTiles(
  home: HomeData,
  waiting: readonly InboxItem[],
  billing: boolean,
): Tile[] {
  const { roles } = home;
  const builds = roles.developer || roles.owner || roles.admin;
  return [
    ...(roles.operator || waiting.length > 0 ? (["inbox"] as const) : []),
    ...(home.cases ? (["cases"] as const) : []),
    ...(builds && home.agents ? (["agents"] as const) : []),
    ...(builds && home.activity ? (["observability"] as const) : []),
    ...(roles.owner && billing ? (["billing"] as const) : []),
    ...(home.members ? (["members"] as const) : []),
  ];
}

const DOT_COLOR = {
  warning: "bg-[color:var(--warning)]",
  danger: "bg-destructive",
} as const;

function ActionCard({
  card,
  onUse,
  onDismiss,
}: Readonly<{ card: HomeCardView; onUse: () => void; onDismiss: () => void }>) {
  const [copied, setCopied] = useState(false);
  return (
    <Card className="relative flex w-full flex-col gap-3 rounded-xl p-4 ring-1 ring-border">
      <div
        className={cn("flex min-w-0 flex-col gap-0.5", card.dismiss && "pr-6")}
      >
        <div className="flex min-w-0 items-start gap-2">
          {card.dot ? (
            <span
              aria-hidden="true"
              className="flex h-[1lh] shrink-0 items-center text-body"
            >
              <span
                className={cn("size-1.5 rounded-full", DOT_COLOR[card.dot])}
              />
            </span>
          ) : null}
          <CardTitle className="text-body" style={medium}>
            {card.title}
          </CardTitle>
        </div>
        {card.line ? (
          <CardDescription className="truncate text-caption">
            {card.line}
          </CardDescription>
        ) : null}
      </div>
      {card.action.kind === "copy" ? (
        <code className="rounded-md bg-muted px-2 py-1.5 font-mono text-caption break-all whitespace-pre-wrap text-foreground">
          {card.action.command}
        </code>
      ) : null}
      <div className="mt-auto">
        {card.action.kind === "link" ? (
          <Button
            onClick={onUse}
            render={<AppLink href={card.action.href} />}
            size="compact"
            variant="secondary"
          >
            {card.action.label}
          </Button>
        ) : (
          <Button
            onClick={() => {
              onUse();
              if (card.action.kind !== "copy") return;
              void navigator.clipboard
                .writeText(card.action.command)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
            }}
            size="compact"
            variant="secondary"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
      </div>
      {card.dismiss ? (
        <Button
          aria-label={`Dismiss ${card.title}`}
          className="absolute top-2 right-2"
          onClick={onDismiss}
          size="icon-compact"
          variant="ghost"
        >
          <X strokeWidth={1.15} />
        </Button>
      ) : null}
    </Card>
  );
}

const TILE: Record<Tile, { label: string; icon: IconComponent; href: string }> =
  {
    inbox: { label: "Inbox", icon: Inbox, href: "/inbox" },
    cases: { label: "Cases", icon: Folder4, href: "/cases" },
    agents: { label: "Agents", icon: OrbitSparkle, href: "/agents" },
    observability: {
      label: "Observability",
      icon: Gauge,
      href: "/developers/observability",
    },
    billing: {
      label: "Billing",
      icon: Coins,
      href: "/settings/organization/billing",
    },
    members: {
      label: "Members and groups",
      icon: Users,
      href: "/settings/organization/members",
    },
  };

const TILE_FRAME =
  "relative flex min-h-48 flex-col gap-3 rounded-xl p-4 ring-1 ring-border";

function TileHeader({
  tile,
  chevron,
}: Readonly<{ tile: Tile; chevron: boolean }>) {
  const { label, icon: Icon } = TILE[tile];
  return (
    <div className="flex items-center gap-2 text-foreground">
      <Icon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
        strokeWidth={1.15}
      />
      <span className="min-w-0 flex-1 truncate text-body" style={medium}>
        {label}
      </span>
      {chevron ? (
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.15}
        />
      ) : null}
    </div>
  );
}

const EMPTY_TILE: Record<
  Tile,
  { art: ReactNode; title: string; action: string; href: string } | null
> = {
  inbox: {
    art: <InboxListArt className="size-20" />,
    title: "Nothing waiting",
    action: "Open Inbox",
    href: "/inbox",
  },
  cases: {
    art: <CasesArt className="size-20" />,
    title: "No cases yet",
    action: "Start a case",
    href: "/cases",
  },
  agents: {
    art: <AgentsArt className="size-20" />,
    title: "No agents yet",
    action: "Deploy an agent",
    href: "/agents",
  },
  observability: {
    art: <LogsArt className="size-20" />,
    title: "No cases today",
    action: "Open Observability",
    href: "/developers/observability",
  },
  billing: null,
  members: null,
};

function PreviewTile(
  props: Readonly<{
    tile: Tile;
    home: HomeData;
    waiting: readonly InboxItem[];
    billing: Billing | null;
    billingPending: boolean;
    spentUsd: number;
    nextInvoice: string | null;
  }>,
) {
  const { tile } = props;
  const body = tileBody(props);
  if (body === EMPTY) {
    const empty = EMPTY_TILE[tile]!;
    return (
      <Card className={TILE_FRAME}>
        <TileHeader chevron={false} tile={tile} />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <EmptyMedia variant="graphic">{empty.art}</EmptyMedia>
          <span className="text-body text-foreground">{empty.title}</span>
          <Button
            onClick={() => captureProductEvent("home_tile_opened", { tile })}
            render={<AppLink href={empty.href} />}
            size="compact"
            variant="secondary"
          >
            {empty.action}
          </Button>
        </div>
      </Card>
    );
  }
  return (
    <Card
      className={cn(
        TILE_FRAME,
        "group transition-colors hover:bg-surface-2 focus-within:ring-[color:var(--focus-ring,#6B97FF)]",
      )}
    >
      <TileHeader chevron tile={tile} />
      <div className="flex min-w-0 flex-1 flex-col">{body}</div>
      <AppLink
        aria-label={TILE[tile].label}
        className="absolute inset-0 rounded-xl outline-none"
        href={TILE[tile].href}
        onClick={() => captureProductEvent("home_tile_opened", { tile })}
      />
    </Card>
  );
}

function Row({
  lead,
  label,
  trail,
}: Readonly<{ lead?: ReactNode; label: string; trail?: ReactNode }>) {
  return (
    <div className="flex min-h-8 min-w-0 items-center gap-2">
      {lead}
      <span
        className="min-w-0 flex-1 truncate text-body text-foreground"
        title={label}
      >
        {label}
      </span>
      {trail ? (
        <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
          {trail}
        </span>
      ) : null}
    </div>
  );
}

const age = (iso: string) => {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - Date.parse(iso)) / 60_000),
  );
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

const caseStatus = (status: string): CaseStatus =>
  status === "waiting" || status === "halted"
    ? "Waiting"
    : status === "queued" || status === "running"
      ? "Active"
      : "Done";

const DEPLOY: Record<string, { label: string; color: string }> = {
  ready: { label: "Ready", color: badgeColors.green },
  building: { label: "Building", color: badgeColors.blue },
  waiting: { label: "Waiting", color: badgeColors.yellow },
  failed: { label: "Failed", color: badgeColors.red },
};

function StatusDot({ color }: Readonly<{ color: string }>) {
  return (
    <span
      aria-hidden="true"
      className="size-1.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

const EMPTY = Symbol("empty");

function tileBody({
  tile,
  home,
  waiting,
  billing,
  billingPending,
  spentUsd,
  nextInvoice,
}: Parameters<typeof PreviewTile>[0]): ReactNode | typeof EMPTY {
  switch (tile) {
    case "inbox":
      if (!waiting.length) return EMPTY;
      return waiting
        .slice(0, 3)
        .map((item) => (
          <Row
            key={item.id}
            label={
              (item.kind === "assignment" ? item.summary : item.title) ||
              "Untitled case"
            }
            trail={age(item.createdAt)}
          />
        ));
    case "cases": {
      const items = home.cases?.items ?? [];
      if (!items.length) return EMPTY;
      return items.map((item) => (
        <Row
          key={item.id}
          lead={<CaseStatusIcon status={caseStatus(item.status)} />}
          label={item.title ?? item.id}
          trail={age(item.updatedAt)}
        />
      ));
    }
    case "agents": {
      const items = home.agents?.items ?? [];
      if (!items.length) return EMPTY;
      return items.map((agent) => (
        <Row
          key={agent.slug}
          lead={<StatusDot color={DEPLOY[agent.status].color} />}
          label={agent.slug}
          trail={agent.live ? DEPLOY[agent.status].label : "Not live"}
        />
      ));
    }
    case "observability": {
      const hours = home.activity?.hours ?? [];
      const total = (key: "started" | "done" | "failed") =>
        hours.reduce((sum, hour) => sum + hour[key], 0);
      if (!total("started") && !total("done") && !total("failed")) return EMPTY;
      return (
        <Activity
          hours={hours}
          totals={{
            started: total("started"),
            done: total("done"),
            failed: total("failed"),
          }}
        />
      );
    }
    case "billing": {
      if (billingPending || !billing) return <TileSkeletonRows rows={2} />;
      const balance = billing.credits
        ? creditsUsd(billing.credits.remaining - billing.credits.owed)
        : 0;
      const ratio = balance + spentUsd > 0 ? balance / (balance + spentUsd) : 0;
      return (
        <div className="flex flex-1 flex-col justify-center gap-2">
          <span
            className="text-title tabular-nums text-foreground"
            style={medium}
          >
            {`${usd(balance)} in credits`}
          </span>
          <div
            aria-hidden="true"
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-foreground"
              style={{ width: `${Math.min(100, ratio * 100)}%` }}
            />
          </div>
          {nextInvoice ? (
            <span className="text-caption text-muted-foreground">
              {`Next invoice ${shortDate(nextInvoice)}`}
            </span>
          ) : null}
        </div>
      );
    }
    case "members": {
      const members = home.members!;
      return (
        <div className="flex flex-1 flex-col justify-center gap-3">
          <AssigneeStack
            assignees={members.people.map((person) => ({
              ...person,
              email: "",
              groups: [],
            }))}
            max={5}
          />
          <span className="text-body tabular-nums text-foreground">
            {members.seats.limit === null
              ? members.seats.used === 1
                ? "1 seat"
                : `${members.seats.used} seats`
              : `${members.seats.used} of ${members.seats.limit} seats`}
          </span>
          <span className="text-caption tabular-nums text-muted-foreground">
            {members.groups === 1 ? "1 group" : `${members.groups} groups`}
          </span>
        </div>
      );
    }
  }
}

const SERIES = [
  { key: "started", label: "Started", color: "var(--info)" },
  { key: "done", label: "Done", color: "var(--success)" },
  { key: "failed", label: "Failed", color: "var(--destructive)" },
] as const;

function Activity({
  hours,
  totals,
}: Readonly<{
  hours: HomeData["activity"] extends infer A
    ? A extends { hours: infer H }
      ? H
      : never
    : never;
  totals: Record<"started" | "done" | "failed", number>;
}>) {
  const max = Math.max(
    1,
    ...hours.flatMap((hour) => [hour.started, hour.done, hour.failed]),
  );
  const width = 240;
  const height = 64;
  const x = (i: number) => (i / Math.max(1, hours.length - 1)) * width;
  const y = (value: number) => height - 2 - (value / max) * (height - 4);
  return (
    <div className="flex flex-1 flex-col justify-between gap-3">
      <svg
        aria-hidden="true"
        className="h-16 w-full"
        preserveAspectRatio="none"
        viewBox={`0 0 ${width} ${height}`}
      >
        {SERIES.map((series) => (
          <polyline
            fill="none"
            key={series.key}
            points={hours
              .map((hour, i) => `${x(i)},${y(hour[series.key])}`)
              .join(" ")}
            stroke={series.color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {SERIES.map((series) => (
          <span
            className="flex items-center gap-1.5 text-caption text-muted-foreground"
            key={series.key}
          >
            <StatusDot color={series.color} />
            {series.label}
            <span className="tabular-nums text-foreground">
              {totals[series.key]}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TileSkeletonRows({ rows }: Readonly<{ rows: number }>) {
  return (
    <div className="flex flex-col gap-3 pt-1">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton
          className="h-4 rounded-md"
          key={i}
          style={{ width: `${80 - i * 15}%` }}
        />
      ))}
    </div>
  );
}

/** The page at its final size while it loads, so nothing jumps. */
export function HomeSkeleton() {
  return (
    <HomeFrame>
      <Skeleton className="h-10 w-72 rounded-lg" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-12 rounded-md" />
        <div className={CARD_GRID}>
          {Array.from({ length: 4 }, (_, i) => (
            <div
              className="flex h-32 flex-col justify-between rounded-xl p-4 ring-1 ring-border"
              key={i}
            >
              <Skeleton className="h-4 w-3/4 rounded-md" />
              <Skeleton className="h-7 w-24 rounded-full" />
            </div>
          ))}
        </div>
      </div>
      <div className={TILE_GRID}>
        {Array.from({ length: 6 }, (_, i) => (
          <div className={TILE_FRAME} key={i}>
            <Skeleton className="h-4 w-1/3 rounded-md" />
            <TileSkeletonRows rows={4} />
          </div>
        ))}
      </div>
    </HomeFrame>
  );
}
