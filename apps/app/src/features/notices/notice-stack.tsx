import { Popover } from "@base-ui/react/popover";
import { Button } from "@preprocess/ui/components/button";
import {
  Card,
  CardDescription,
  CardTitle,
} from "@preprocess/ui/components/card";
import { useSidebar } from "@preprocess/ui/components/sidebar";
import {
  Bell,
  CircleAlert,
  Megaphone,
  TriangleAlertIcon as TriangleAlert,
} from "@preprocess/ui/lib/icons";
import { cn } from "@preprocess/ui/lib/utils";
import { useState } from "react";

import type { Notice, NoticeLevel } from "./notices";
import { useNotices } from "./use-notices";

const ICON = {
  error: CircleAlert,
  warning: TriangleAlert,
  announcement: Megaphone,
} as const;

const TONE: Record<NoticeLevel, string> = {
  error: "text-destructive",
  warning: "text-[color:var(--warning)]",
  announcement: "text-[color:var(--info)]",
};

const DOT: Record<NoticeLevel, string> = {
  error: "bg-destructive",
  warning: "bg-[color:var(--warning)]",
  announcement: "bg-[color:var(--info)]",
};

const SHOWN = 2;

function NoticeCard({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss: (id: string) => void;
}) {
  const Icon = ICON[notice.level];
  return (
    <Card
      className="min-h-0 rounded-xl bg-surface-3 pb-0 shadow-xs ring-1 ring-border"
      dismissOnHover={false}
      dismissible={notice.dismissible}
      href={notice.href}
      label={notice.href ? notice.title : undefined}
      onDismiss={() => onDismiss(notice.id)}
      size="compact"
    >
      <div className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
        <div
          className={cn(
            "flex min-w-0 items-center gap-1.5",
            notice.dismissible && "pr-5",
          )}
        >
          <Icon
            aria-hidden="true"
            className={cn("shrink-0", TONE[notice.level])}
            size={14}
            strokeWidth={1.15}
          />
          <CardTitle className="truncate">{notice.title}</CardTitle>
        </div>
        <CardDescription className="truncate text-caption">
          {notice.detail}
        </CardDescription>
      </div>
    </Card>
  );
}

function NoticeList({
  notices,
  onDismiss,
  expandable = true,
}: {
  notices: Notice[];
  onDismiss: (id: string) => void;
  expandable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (notices.length === 0) return null;
  const more = expandable ? notices.length - SHOWN : 0;
  const shown = more > 0 && !expanded ? notices.slice(0, SHOWN) : notices;
  return (
    <div aria-label="Notices" className="flex flex-col gap-1.5" role="region">
      {shown.map((notice) => (
        <NoticeCard key={notice.id} notice={notice} onDismiss={onDismiss} />
      ))}
      {more > 0 ? (
        <Button
          className="self-start"
          onClick={() => setExpanded((open) => !open)}
          size="compact"
          type="button"
          variant="ghost"
        >
          {expanded ? "Show less" : `+${more} more`}
        </Button>
      ) : null}
    </div>
  );
}

/** The notice stack in the sidebar footer, above the user card. */
export function SidebarNoticeStack() {
  const { notices, dismiss } = useNotices();
  return <NoticeList notices={notices} onDismiss={dismiss} />;
}

/**
 * The collapsed sidebar's way to the stack: a bell in the inset topbar with a
 * dot in the top notice's color, opening the stack in a popover.
 */
export function CollapsedNoticesButton() {
  const { open, isMobile } = useSidebar();
  const { notices, dismiss } = useNotices();
  const top = notices[0];
  if (open || isMobile || !top) return null;
  return (
    <Popover.Root>
      <div className="relative">
        <Popover.Trigger
          render={
            <Button
              aria-label={`Notices (${notices.length})`}
              size="icon-compact"
              type="button"
              variant="ghost"
            />
          }
        >
          <Bell strokeWidth={1.15} />
        </Popover.Trigger>
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute right-1 top-1 size-1.5 rounded-full",
            DOT[top.level],
          )}
        />
      </div>
      <Popover.Portal>
        <Popover.Positioner
          align="start"
          className="isolate z-50"
          side="bottom"
          sideOffset={6}
        >
          <Popover.Popup className="w-[264px] rounded-2xl bg-surface-6 p-2 shadow-lg ring-1 ring-border outline-none">
            <NoticeList
              expandable={false}
              notices={notices}
              onDismiss={dismiss}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
