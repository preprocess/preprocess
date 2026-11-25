import { Badge } from "@preprocess/ui/components/badge";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { AsyncActionAbortError } from "@preprocess/ui/hooks/use-async-action";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { useState } from "react";

import type { ApprovalDecision, RoomMemory } from "./case-room-state";
import type { CaseWorkActions } from "./case-work-context";

const semibold = { fontVariationSettings: fontWeights.semibold };

// UTC, so the server render and the browser agree.
const time = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const STATUS_LABEL: Record<RoomMemory["status"], string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  dismissed: "Dismissed",
  deleted: "Deleted",
};

/** What the API's refusal means for the person deciding. */
function refusal(decision: Extract<ApprovalDecision, { ok: false }>) {
  switch (decision.code) {
    case "forbidden":
      return "Deciding a rule needs operator access to this agent.";
    case "memory_decided":
      return "Someone already decided this. The latest decision is shown.";
    default:
      return decision.message;
  }
}

function MemoryRow({
  memory,
  actions,
}: Readonly<{ memory: RoomMemory; actions: CaseWorkActions }>) {
  const [error, setError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  const decide = async (decision: "accept" | "dismiss") => {
    setError(null);
    const result = await actions.decideMemory({
      memoryId: memory.id,
      decision,
    });
    if (result.ok) return;
    setError(refusal(result));
    if (result.code === "forbidden") setReadOnly(true);
    throw new AsyncActionAbortError();
  };

  return (
    <li
      className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0"
      data-memory={memory.id}
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body text-foreground" style={semibold}>
            {memory.text}
          </span>
          {memory.reason ? (
            <span className="text-body text-muted-foreground">
              {memory.reason}
            </span>
          ) : null}
        </div>
        <Badge className="shrink-0" size="sm">
          {STATUS_LABEL[memory.status]}
        </Badge>
      </div>
      {memory.status !== "proposed" && memory.decidedAt ? (
        <span className="text-body text-muted-foreground">
          {STATUS_LABEL[memory.status]} by {memory.decidedByName ?? "a person"}
          {` · ${time.format(new Date(memory.decidedAt))}`}
        </span>
      ) : null}
      {error ? (
        <span className="text-body text-destructive" role="alert">
          {error}
        </span>
      ) : null}
      {memory.status === "proposed" && !readOnly ? (
        <div className="flex items-center justify-end gap-1.5">
          <LoadingButton
            className="w-auto shrink-0"
            onAction={() => decide("dismiss")}
            pendingLabel="Dismissing"
            size="compact"
            successLabel="Dismissed"
            variant="secondary"
          >
            Dismiss
          </LoadingButton>
          <LoadingButton
            className="w-auto shrink-0"
            onAction={() => decide("accept")}
            pendingLabel="Accepting"
            size="compact"
            successLabel="Accepted"
          >
            Accept
          </LoadingButton>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Rules the agent proposed on this case for its memory, proposed ones first.
 * Accepting one gives it to every new case and rerun of the agent.
 */
export function CaseRoomMemories({
  memories,
  actions,
}: Readonly<{ memories: readonly RoomMemory[]; actions: CaseWorkActions }>) {
  if (memories.length === 0) return null;
  const ordered = [
    ...memories.filter((m) => m.status === "proposed"),
    ...memories.filter((m) => m.status !== "proposed").reverse(),
  ];
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-body text-foreground" style={semibold}>
          Proposed memories
        </h2>
        <span className="text-body text-muted-foreground">
          Accepted rules go to every new case and rerun of this agent.
        </span>
      </div>
      <ul className="border border-border bg-surface-1">
        {ordered.map((memory) => (
          <MemoryRow actions={actions} key={memory.id} memory={memory} />
        ))}
      </ul>
    </section>
  );
}
