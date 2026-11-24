import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@preprocess/ui/components/empty";
import type { ReactNode } from "react";

import {
  HourglassArt,
  LuggageTagArt,
  ScaleArt,
} from "../../components/empty-art";

import type { INPUT_TAB } from "./case-input-workspace";
import type { RoomViewId } from "./case-room-tabs";

export type CaseRoomEmptyViewId = Exclude<RoomViewId, typeof INPUT_TAB>;

export function CaseRoomViewEmpty({ viewId }: { viewId: CaseRoomEmptyViewId }) {
  let graphic: ReactNode;
  let title: string;
  let description: string;
  switch (viewId) {
    case "review":
      graphic = <ScaleArt />;
      title = "No review yet";
      description = "Confirm findings and actions the agent extracts.";
      break;
    case "events":
      graphic = <HourglassArt />;
      title = "No events yet";
      description = "Activity will show up here as this case progresses.";
      break;
    case "details":
      graphic = <LuggageTagArt />;
      title = "No details yet";
      description = "Case details will show up here when they are available.";
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
        <EmptyMedia variant="graphic">{graphic}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
