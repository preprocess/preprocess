import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@preprocess/ui/components/empty";

import { FillsOnItsOwnArt } from "./empty-art";

export function ChatEmpty() {
  return (
    <Empty
      key="chat-empty"
      className="pointer-events-none absolute inset-0 z-[1] border-0 p-0"
    >
      <EmptyHeader className="pointer-events-auto group">
        <EmptyMedia variant="graphic">
          <FillsOnItsOwnArt />
        </EmptyMedia>
        <EmptyTitle>No messages yet</EmptyTitle>
        <EmptyDescription>
          The agent's thread and any team replies appear here as the case runs.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
