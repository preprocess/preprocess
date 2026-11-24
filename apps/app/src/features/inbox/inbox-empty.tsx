import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@preprocess/ui/components/empty";

import { EspressoArt, MailboxArt } from "../../components/empty-art";

export type InboxEmptyKind = "list" | "caught-up" | "pick";

export function InboxEmpty({
  kind,
  unread = 0,
}: {
  kind: InboxEmptyKind;
  unread?: number;
}) {
  let title: string;
  let description: string;
  switch (kind) {
    case "list":
      title = "No notifications";
      description = "Mentions and case updates will show up here.";
      break;
    case "caught-up":
      title = "You're all caught up";
      description = "Open a notification to read the full note.";
      break;
    case "pick":
      title =
        unread === 1
          ? "1 unread notification"
          : `${unread} unread notifications`;
      description =
        unread === 0
          ? "Select an item to read it."
          : "Select an item from the list to read it.";
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
        <EmptyMedia variant="graphic">
          {kind === "list" ? <MailboxArt /> : <EspressoArt />}
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
