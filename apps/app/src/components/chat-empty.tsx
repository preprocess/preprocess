import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@preprocess/ui/components/empty";

import { ChatEmptyArt } from "./empty-art";

export function ChatEmpty() {
  return (
    <Empty
      key="chat-empty"
      className="pointer-events-none absolute inset-0 z-[1] border-0 p-0"
    >
      <EmptyHeader className="pointer-events-auto group">
        <EmptyMedia variant="graphic">
          <ChatEmptyArt />
        </EmptyMedia>
        <EmptyTitle>No messages yet</EmptyTitle>
        <EmptyDescription>Send a message to start this case.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
