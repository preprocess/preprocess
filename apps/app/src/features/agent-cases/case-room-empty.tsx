import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@preprocess/ui/components/empty";
import type { ReactNode } from "react";

import { CaseReviewArt, CaseRunArt } from "../../components/empty-art";

import type { INPUT_TAB } from "./case-input-workspace";
import type { RoomViewId } from "./case-room-tabs";

export type CaseRoomEmptyViewId = Exclude<RoomViewId, typeof INPUT_TAB>;

export function CaseRoomViewEmpty({ viewId }: { viewId: CaseRoomEmptyViewId }) {
  let graphic: ReactNode;
  let title: string;
  let description: string;
  switch (viewId) {
    case "review":
      graphic = <CaseReviewArt />;
      title = "No review yet";
      description = "Confirm findings and actions the agent extracts.";
      break;
    case "run":
      graphic = <CaseRunArt />;
      title = "No runs yet";
      description = "Each run and what happened in it shows up here.";
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
