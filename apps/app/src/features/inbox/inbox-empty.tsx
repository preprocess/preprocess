import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@preprocess/ui/components/empty";
import type { ReactNode } from "react";

import {
  FillsOnItsOwnArt,
  NothingSelectedArt,
} from "../../components/empty-art";

export type InboxEmptyKind = "list" | "pick" | "pick-empty-list";

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
    case "pick":
      art = <NothingSelectedArt />;
      title = "No message selected";
      description = "Choose a message from the list to read it here.";
      break;
    case "pick-empty-list":
      art = null;
      title = "No message selected";
      description = "Messages you open from the list show up here.";
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
        {art ? <EmptyMedia variant="graphic">{art}</EmptyMedia> : null}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
