import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { fontWeights } from "@preprocess/ui/lib/font-weight";

import type { RoomMessage } from "./case-room-state";
import { groupName } from "./case-room-review";
import { useCaseWork } from "./case-work-context";

// UTC, so the server render and the browser agree.
const time = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const AUTHOR: Record<RoomMessage["kind"], string> = {
  input: "Input",
  agent: "Agent",
  person: "Person",
  tag: "Agent",
  event: "Preprocess",
};

function headline(message: RoomMessage) {
  if (message.kind === "tag" && message.group)
    return `Tagged ${groupName(message.group)}`;
  if (message.kind === "person")
    return message.by === "person:usr_you" ? "You" : "A person";
  return AUTHOR[message.kind];
}

/** The Run view: each run and what happened in it, oldest first. */
export function CaseRoomRun() {
  const work = useCaseWork();
  if (!work || work.room.thread.length === 0) return null;
  const { room } = work;
  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-5 py-5">
        <span className="text-body text-muted-foreground">
          {room.run === 1 ? "1 run" : `${room.run} runs`}
        </span>
        <ol className="flex flex-col border-l border-border">
          {room.thread.map((message) => (
            <li
              className="relative flex flex-col gap-0.5 py-2 pl-4 before:absolute before:top-3.5 before:-left-[3px] before:size-1.5 before:rounded-full before:bg-muted-foreground"
              key={message.id}
            >
              <span className="flex items-baseline gap-2">
                <span
                  className="text-body text-foreground"
                  style={{ fontVariationSettings: fontWeights.semibold }}
                >
                  {headline(message)}
                </span>
                <span className="text-body text-muted-foreground">
                  {time.format(new Date(message.at))}
                </span>
              </span>
              <span className="text-body text-muted-foreground">
                {message.text}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </ScrollArea>
  );
}
