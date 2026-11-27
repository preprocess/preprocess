import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@preprocess/ui/components/empty";
import type { ReactNode } from "react";

import {
  AllCaughtUpArt,
  FillsOnItsOwnArt,
  NothingSelectedArt,
} from "../../components/empty-art";

export type InboxEmptyKind = "list" | "caught-up" | "all-read" | "pick";

export function InboxEmpty({ kind }: { kind: InboxEmptyKind }) {
  let art: ReactNode;
  let title: string;
  let description: string;
  switch (kind) {
    case "list":
      art = <FillsOnItsOwnArt />;
      title = "Inbox is empty";
      description =
        "Reviews, approvals, memory proposals and mentions show up here.";
      break;
    case "caught-up":
      art = <AllCaughtUpArt />;
      title = "All caught up";
      description = "Nothing needs your attention right now.";
      break;
    case "all-read":
      art = <AllCaughtUpArt />;
      title = "All caught up";
      description =
        "No unread items. Reviews, approvals and mentions show up here.";
      break;
    case "pick":
      art = <NothingSelectedArt />;
      title = "Select an item";
      description =
        "Pick a notification from the list to read it and act on it.";
      break;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }

  return (
    <Empty
      className="pointer-events-none absolute inset-0 z-[1] border-0 p-0"
      initial={false}
    >
      <EmptyHeader className="pointer-events-auto group">
        <EmptyMedia variant="graphic">{art}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
