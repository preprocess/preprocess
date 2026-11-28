import type { ReactNode } from "react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@preprocess/ui/components/empty";

import { ReviewTabArt, RunTabArt } from "../../components/empty-art";

import type { INPUT_TAB } from "./case-input-workspace";
import type { RoomViewId } from "./case-room-tabs";

export type CaseRoomEmptyViewId = Exclude<RoomViewId, typeof INPUT_TAB>;

export function CaseRoomViewEmpty({ viewId }: { viewId: CaseRoomEmptyViewId }) {
  let art: ReactNode;
  let title: string;
  let description: string;
  switch (viewId) {
    case "review":
      art = <ReviewTabArt />;
      title = "Nothing to review yet";
      description =
        "Answers from the agent's output schema appear here once the run fills them in.";
      break;
    case "run":
      art = <RunTabArt />;
      title = "No run activity yet";
      description =
        "Model calls, tool calls and timing appear here once the case starts running.";
      break;
    default: {
      const _exhaustive: never = viewId;
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
