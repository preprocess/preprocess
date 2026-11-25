import { Badge, badgeColors } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import { EmptyPresence } from "@preprocess/ui/components/empty";
import { FluidHoverHighlight } from "@preprocess/ui/components/fluid-hover-highlight";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@preprocess/ui/components/resizable";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { Tooltip } from "@preprocess/ui/components/tooltip";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@preprocess/ui/hooks/use-fluid-hover";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  OrbitSparkle,
  ArrowRight,
  BadgeCheck,
  Brain,
  CheckIcon,
  Clock,
  Folder4,
  MessageCircle,
  Shield,
  User,
} from "@preprocess/ui/lib/icons";
import { ShapeProvider, useShape } from "@preprocess/ui/lib/shape-context";
import { cn } from "@preprocess/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, type ComponentType, type SVGProps } from "react";

import { PageHeader, PageTitle } from "../../components/page-header";
import { useHotkeys } from "../../components/use-hotkeys";
import { awaitingPhrase, caseTitle, type Case } from "../agent-cases/case";
import { parseAgentId, parseCaseId } from "../agent-cases/agent-case-ref";
import { CaseStatusIcon } from "../agent-cases/case-status-icon";
import { InboxEmpty } from "./inbox-empty";
import {
  formatInboxTime,
  inboxKindLabel,
  unreadCount,
  type InboxDetail,
  type InboxItem,
  type InboxKind,
} from "./notification";

const LIST_PANEL_SIZE = 380;
const LIST_PANEL_MIN = 280;

type KindIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

const KIND_ICON: Record<InboxKind, KindIcon> = {
  mention: MessageCircle,
  assignment: User,
  "case-update": Folder4,
  agent: OrbitSparkle,
  overdue: Clock,
  approval: BadgeCheck,
  guardrail: Shield,
  memory: Brain,
};

/** Linked cases by `agentId/caseId`, as the route loads them. */
export type InboxCases = Readonly<Record<string, Case>>;

export function inboxCaseKey(agentId: string, caseId: string) {
  return `${agentId}/${caseId}`;
}

function linkedCase(item: InboxItem, cases: InboxCases): Case | undefined {
  if (item.link?.kind !== "case") return undefined;
  return cases[inboxCaseKey(item.link.agentId, item.link.caseId)];
}

function KindMark({ kind }: Readonly<{ kind: InboxKind }>) {
  const Icon = KIND_ICON[kind];
  const overdue = kind === "overdue";
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-hover text-muted-foreground"
      style={
        overdue
          ? {
              color: badgeColors.red,
              backgroundColor: `color-mix(in srgb, ${badgeColors.red} 14%, transparent)`,
            }
          : undefined
      }
    >
      <Icon className="size-3.5" />
    </span>
  );
}

function InboxRow({
  item,
  index,
  selected,
  nowMs,
  registerItem,
  onSelect,
}: Readonly<{
  item: InboxItem;
  index: number;
  selected: boolean;
  nowMs: number;
  registerItem: (index: number, element: HTMLElement | null) => void;
  onSelect: (id: string) => void;
}>) {
  const ref = useRef<HTMLButtonElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  const shape = useShape();

  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={cn(
        "relative flex w-full min-w-0 cursor-pointer items-start gap-3 px-3 py-2.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring)",
        shape.item,
        selected && "bg-active",
      )}
      data-inbox-row={index}
      onClick={() => onSelect(item.id)}
      ref={ref}
      type="button"
    >
      <KindMark kind={item.kind} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate text-body text-foreground"
            style={{
              fontVariationSettings: item.unread
                ? fontWeights.semibold
                : fontWeights.normal,
            }}
          >
            {item.title}
          </span>
          {item.unread ? (
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: badgeColors.blue }}
            >
              <span className="sr-only">Unread</span>
            </span>
          ) : null}
          <time
            className="shrink-0 text-caption text-muted-foreground tabular-nums"
            dateTime={item.createdAt}
          >
            {formatInboxTime(item.createdAt, nowMs)}
          </time>
        </span>
        <span className="mt-0.5 block truncate text-caption text-muted-foreground">
          {item.summary}
        </span>
      </span>
    </button>
  );
}

function InboxList({
  items,
  selectedId,
  nowMs,
  onSelect,
}: Readonly<{
  items: readonly InboxItem[];
  selectedId: string | undefined;
  nowMs: number;
  onSelect: (id: string) => void;
}>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(containerRef);
  const shape = useShape();

  return (
    <div
      className="relative flex flex-col gap-1 px-2 py-2"
      onMouseEnter={hover.handlers.onMouseEnter}
      onMouseLeave={hover.handlers.onMouseLeave}
      onMouseMove={hover.handlers.onMouseMove}
      ref={containerRef}
    >
      <FluidHoverHighlight hover={hover} className={shape.bg} />
      {items.map((item, index) => (
        <InboxRow
          index={index}
          item={item}
          key={item.id}
          nowMs={nowMs}
          onSelect={onSelect}
          registerItem={hover.registerItem}
          selected={item.id === selectedId}
        />
      ))}
    </div>
  );
}

function LinkedCaseCard({ item }: Readonly<{ item: Case }>) {
  return (
    <Link
      className="group flex items-center gap-3 rounded-xl bg-surface-3 px-4 py-3 outline-none transition-colors duration-80 hover:bg-surface-4 focus-visible:ring-1 focus-visible:ring-(--focus-ring)"
      params={{ agentId: item.agentId, caseId: item.id }}
      to="/agents/$agentId/cases/$caseId"
    >
      <CaseStatusIcon status={item.status} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate text-body text-foreground"
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {caseTitle(item)}
        </span>
        <span className="truncate text-caption text-muted-foreground">
          {item.status}
          {awaitingPhrase(item.awaiting)
            ? ` · ${awaitingPhrase(item.awaiting)}`
            : ""}
        </span>
      </span>
      <Badge size="sm">{item.agentId}</Badge>
      <ArrowRight
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
      />
    </Link>
  );
}

function InboxDetails({
  details,
}: Readonly<{ details: readonly InboxDetail[] }>) {
  return (
    <dl className="flex flex-col gap-3 rounded-xl bg-surface-3 px-4 py-3">
      {details.map((detail) => (
        <div className="flex min-w-0 flex-col gap-0.5" key={detail.label}>
          <dt className="text-caption text-muted-foreground">{detail.label}</dt>
          <dd className="whitespace-pre-wrap break-words text-body text-foreground">
            {detail.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ReaderAction({ item }: Readonly<{ item: InboxItem }>) {
  const link = item.link;
  if (!link) return null;
  switch (link.kind) {
    case "case":
      return (
        <Button
          render={
            <Link
              params={{
                agentId: parseAgentId(link.agentId),
                caseId: parseCaseId(link.caseId),
              }}
              search={link.view ? { view: link.view } : {}}
              to="/agents/$agentId/cases/$caseId"
            />
          }
          type="button"
          variant="secondary"
        >
          {item.kind === "approval" || link.view === "review"
            ? "Review in case"
            : "Open case"}
        </Button>
      );
    case "agent":
      return (
        <Button
          render={
            <Link
              params={{ agentId: link.agentId }}
              to="/agents/$agentId/cases"
            />
          }
          type="button"
          variant="secondary"
        >
          View cases
        </Button>
      );
    case "guardrail":
      return (
        <Button
          render={
            link.agentSlug ? (
              <Link
                hash="requests"
                params={{ agentId: link.agentSlug }}
                search={{ request: link.requestId }}
                to="/agents/$agentId/settings"
              />
            ) : (
              <Link
                hash="requests"
                search={{ request: link.requestId }}
                to="/settings/organization/guardrails"
              />
            )
          }
          type="button"
          variant="secondary"
        >
          Review request
        </Button>
      );
    default: {
      const exhaustive: never = link;
      return exhaustive;
    }
  }
}

function InboxReader({
  item,
  linked,
}: Readonly<{ item: InboxItem; linked: Case | undefined }>) {
  return (
    <section
      aria-label="Notification"
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
    >
      <PageHeader
        sidebarTrigger={false}
        trailing={<ReaderAction item={item} />}
      >
        <span className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
          <span>{inboxKindLabel(item.kind)}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={item.createdAt}>
            {formatInboxTime(item.createdAt)}
          </time>
        </span>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
          <article className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 pb-10 pt-6">
            <header className="flex flex-col gap-1">
              <h2
                className="text-title tracking-[-0.02em] text-foreground"
                style={{ fontVariationSettings: fontWeights.semibold }}
              >
                {item.title}
              </h2>
              <p className="text-body text-muted-foreground">{item.summary}</p>
            </header>
            <p className="text-body leading-relaxed text-foreground">
              {item.body}
            </p>
            {item.details?.length ? (
              <InboxDetails details={item.details} />
            ) : null}
            {linked ? <LinkedCaseCard item={linked} /> : null}
          </article>
        </ScrollArea>
      </div>
    </section>
  );
}

export function Inbox({
  items = [],
  cases = {},
  selectedId,
  onSelect,
  onMarkAllRead,
}: Readonly<{
  items?: readonly InboxItem[];
  cases?: InboxCases;
  selectedId?: string;
  onSelect?: (id: string | undefined) => void;
  onMarkAllRead?: () => void;
}>) {
  const navigate = useNavigate();
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const selected = selectedIndex === -1 ? undefined : items[selectedIndex];
  const unread = unreadCount(items);
  const nowMs = Date.now();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedIndex === -1) return;
    listRef.current
      ?.querySelector(`[data-inbox-row="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const step = (delta: number) => {
    if (items.length === 0) return;
    const next =
      selectedIndex === -1
        ? 0
        : Math.min(Math.max(selectedIndex + delta, 0), items.length - 1);
    const item = items[next];
    if (item) onSelect?.(item.id);
  };

  const openLinked = () => {
    const link = selected?.link;
    if (link?.kind !== "case") return;
    void navigate({
      to: "/agents/$agentId/cases/$caseId",
      params: {
        agentId: parseAgentId(link.agentId),
        caseId: parseCaseId(link.caseId),
      },
    });
  };

  useHotkeys({
    j: () => step(1),
    k: () => step(-1),
    ArrowDown: () => step(1),
    ArrowUp: () => step(-1),
    Enter: openLinked,
    o: openLinked,
    Escape: selected ? () => onSelect?.(undefined) : undefined,
  });

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 overflow-hidden"
      data-testid="inbox"
    >
      <ResizablePanelGroup className="min-h-0 flex-1" orientation="horizontal">
        <ResizablePanel
          className="min-h-0 min-w-0"
          defaultSize={LIST_PANEL_SIZE}
          minSize={LIST_PANEL_MIN}
        >
          <div className="flex h-full min-h-0 flex-col">
            <PageHeader
              trailing={
                unread > 0 && onMarkAllRead ? (
                  <Tooltip content="Mark all as read" side="bottom">
                    <Button
                      aria-label="Mark all as read"
                      onClick={onMarkAllRead}
                      size="icon-compact"
                      type="button"
                      variant="ghost"
                    >
                      <CheckIcon aria-hidden="true" />
                    </Button>
                  </Tooltip>
                ) : null
              }
            >
              <PageTitle>Inbox</PageTitle>
              {unread > 0 ? (
                <span className="text-caption text-muted-foreground tabular-nums">
                  {unread} unread
                </span>
              ) : null}
            </PageHeader>
            {items.length === 0 ? (
              <div className="relative min-h-0 flex-1">
                <EmptyPresence>
                  <InboxEmpty kind="list" />
                </EmptyPresence>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <ScrollArea
                  className="min-h-0 flex-1"
                  ref={listRef}
                  viewportClassName="scroll-fade"
                >
                  <ShapeProvider defaultShape="rounded">
                    <InboxList
                      items={items}
                      nowMs={nowMs}
                      onSelect={(id) => onSelect?.(id)}
                      selectedId={selectedId}
                    />
                  </ShapeProvider>
                </ScrollArea>
              </div>
            )}
          </div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize inbox reader" />
        <ResizablePanel className="relative min-h-0 min-w-0" minSize={320}>
          {selected ? (
            <InboxReader item={selected} linked={linkedCase(selected, cases)} />
          ) : (
            <EmptyPresence>
              <InboxEmpty
                kind={items.length === 0 ? "caught-up" : "pick"}
                unread={unread}
              />
            </EmptyPresence>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
