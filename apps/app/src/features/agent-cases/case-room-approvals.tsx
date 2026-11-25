import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { AsyncActionAbortError } from "@preprocess/ui/hooks/use-async-action";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { useRef, useState } from "react";

import {
  fieldLabel,
  formatValue,
  type ApprovalDecision,
  type CaseRoomState,
  type RoomApproval,
} from "./case-room-state";
import { groupName } from "./case-room-review";
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

const STATUS_LABEL: Record<RoomApproval["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  stale: "Out of date",
};

function subject(approval: RoomApproval) {
  switch (approval.level) {
    case "tool":
      return `Call ${approval.target}`;
    case "field":
      return `Answer for ${fieldLabel(approval.target)}`;
    case "completion":
      return "Completing the case";
  }
}

const approver = (approval: RoomApproval) =>
  approval.group ? groupName(approval.group) : "Any operator";

/** What the API's refusal means for the person deciding. */
function refusal(
  approval: RoomApproval,
  decision: Extract<ApprovalDecision, { ok: false }>,
) {
  switch (decision.code) {
    case "forbidden":
      return approval.group
        ? `Only members of ${groupName(approval.group)} can decide this.`
        : "Deciding needs operator access to this agent.";
    case "approval_decided":
      return "Someone already decided this. The latest decision is shown.";
    case "case_running":
      return "The agent is running. Decide once the run ends.";
    default:
      return decision.message;
  }
}

/** The tool call's input, the field's value; completion approves the run. */
function Payload({
  approval,
  room,
}: Readonly<{ approval: RoomApproval; room: CaseRoomState }>) {
  if (approval.level === "completion") return null;
  if (approval.level === "field") {
    const field = room.fields.find((f) => f.path === approval.target);
    return (
      <span className="text-body text-foreground" style={semibold}>
        {field
          ? formatValue(field, approval.payload)
          : JSON.stringify(approval.payload)}
      </span>
    );
  }
  return (
    <pre className="overflow-x-auto border border-border bg-background px-3 py-2 text-body whitespace-pre-wrap text-foreground">
      {JSON.stringify(approval.payload, null, 2)}
    </pre>
  );
}

function DecisionForm({
  approval,
  decision,
  actions,
  onClose,
}: Readonly<{
  approval: RoomApproval;
  decision: "approve" | "reject";
  actions: CaseWorkActions;
  onClose: () => void;
}>) {
  const textRef = useRef<InlineValidationHandle>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const approve = decision === "approve";

  const submit = async () => {
    if (!textRef.current?.commit()) throw new AsyncActionAbortError();
    setError(null);
    const result = await actions.decide({
      approvalId: approval.id,
      decision,
      text,
    });
    if (!result.ok) {
      setError(refusal(approval, result));
      throw new AsyncActionAbortError();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <InlineValidation
        autoFocus
        id={`${approval.id}-${decision}`}
        label={approve ? "Note (optional)" : "Reason"}
        onChange={setText}
        ref={textRef}
        validate={(next) =>
          approve || next.trim()
            ? null
            : "Say why. The agent and the thread see the reason."
        }
        value={text}
      />
      {error ? (
        <span className="text-body text-destructive" role="alert">
          {error}
        </span>
      ) : null}
      <div className="flex items-center justify-end gap-1.5">
        <Button onClick={onClose} size="compact" type="button" variant="ghost">
          Cancel
        </Button>
        <LoadingButton
          className="w-auto shrink-0"
          onAction={submit}
          pendingLabel={approve ? "Approving" : "Rejecting"}
          size="compact"
          successLabel={approve ? "Approved" : "Rejected"}
          variant={approve ? "primary" : "secondary"}
        >
          {approve ? "Approve" : "Reject"}
        </LoadingButton>
      </div>
    </div>
  );
}

function ApprovalRow({
  approval,
  room,
  actions,
}: Readonly<{
  approval: RoomApproval;
  room: CaseRoomState;
  actions: CaseWorkActions;
}>) {
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const pending = approval.status === "pending";
  const decided =
    approval.status === "approved" || approval.status === "rejected";

  return (
    <li
      className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0"
      data-approval={approval.id}
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body text-foreground" style={semibold}>
            {subject(approval)}
          </span>
          <span className="text-body text-muted-foreground">
            Approver: {approver(approval)}
          </span>
          {approval.reason ? (
            <span className="text-body text-muted-foreground">
              {approval.reason}
            </span>
          ) : null}
        </div>
        <Badge className="shrink-0" size="sm">
          {STATUS_LABEL[approval.status]}
        </Badge>
      </div>
      <Payload approval={approval} room={room} />
      {decided ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-body text-muted-foreground">
            {approval.status === "approved" ? "Approved" : "Rejected"} by{" "}
            {approval.decidedByName ?? "a person"}
            {approval.decidedAt
              ? ` · ${time.format(new Date(approval.decidedAt))}`
              : null}
          </span>
          {approval.note ? (
            <span className="text-body text-foreground">{approval.note}</span>
          ) : null}
        </div>
      ) : null}
      {approval.status === "stale" ? (
        <span className="text-body text-muted-foreground">
          No longer needed: what it asked about changed.
        </span>
      ) : null}
      {pending && room.status === "running" ? (
        <span className="text-body text-muted-foreground">
          Decide once the run ends.
        </span>
      ) : null}
      {pending && room.status !== "running" ? (
        deciding ? (
          <DecisionForm
            actions={actions}
            approval={approval}
            decision={deciding}
            key={deciding}
            onClose={() => setDeciding(null)}
          />
        ) : (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              onClick={() => setDeciding("reject")}
              size="compact"
              type="button"
              variant="secondary"
            >
              Reject
            </Button>
            <Button
              onClick={() => setDeciding("approve")}
              size="compact"
              type="button"
            >
              Approve
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}

/** What the agent's code asked people to approve, pending ones first. */
export function CaseRoomApprovals({
  room,
  actions,
}: Readonly<{ room: CaseRoomState; actions: CaseWorkActions }>) {
  if (room.approvals.length === 0) return null;
  const approvals = [
    ...room.approvals.filter((a) => a.status === "pending"),
    ...room.approvals.filter((a) => a.status !== "pending").reverse(),
  ];
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-body text-foreground" style={semibold}>
        Approvals
      </h2>
      <ul className="border border-border bg-surface-1">
        {approvals.map((approval) => (
          <ApprovalRow
            actions={actions}
            approval={approval}
            key={approval.id}
            room={room}
          />
        ))}
      </ul>
    </section>
  );
}
