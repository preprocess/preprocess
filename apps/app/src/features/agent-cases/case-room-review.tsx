import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import { Input } from "@preprocess/ui/components/input";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { AsyncActionAbortError } from "@preprocess/ui/hooks/use-async-action";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import {
  CircleCheckIcon,
  Loader,
  TriangleAlertIcon,
} from "@preprocess/ui/lib/icons";
import { cn } from "@preprocess/ui/lib/utils";
import { useState, type ReactNode } from "react";

import {
  HALT_REASONS,
  fieldLabel,
  formatValue,
  isEditable,
  type CaseRoomState,
  type RoomField,
  type WriteResult,
} from "./case-room-state";
import { CaseRoomApprovals } from "./case-room-approvals";
import { CaseRoomMemories } from "./case-room-memories";
import { useCaseWork, type CaseWorkActions } from "./case-work-context";

const semibold = { fontVariationSettings: fontWeights.semibold };

/** "accounts-payable" → "Accounts payable". */
export function groupName(slug: string) {
  const words = slug.replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function who(setBy: string) {
  if (setBy === "agent") return "Agent";
  return setBy === "person:usr_you" ? "You" : "A person";
}

/** Whether the Review view has anything to show. */
export const hasReview = (room: CaseRoomState) =>
  room.fields.length > 0 ||
  room.approvals.length > 0 ||
  room.memories.length > 0;

/** Where the case stands, above the fields: a wait, a halt, a failure. */
export function CaseWorkNotice({
  room,
  actions,
}: Readonly<{ room: CaseRoomState; actions: CaseWorkActions }>) {
  let tone: "info" | "warning" | "error" = "info";
  let title: string;
  let body: string | null = null;
  let rerun = false;
  switch (room.status) {
    case "running":
      title = `Run ${room.run} in progress`;
      body = "The agent is working this case. Answers update as it goes.";
      break;
    case "waiting":
      tone = "warning";
      // A case held for an approval waits on no group of its own.
      title = room.waitingOn
        ? `Waiting on ${groupName(room.waitingOn.group)}`
        : room.approvals.some((a) => a.status === "pending")
          ? "Waiting for approval"
          : "Waiting on people";
      body = room.waitingOn?.reason ?? null;
      break;
    case "halted":
      tone = "error";
      title = "Halted";
      body = `${HALT_REASONS[room.reason ?? ""] ?? "The case was stopped before its next metered call."} Rerun restarts it once that changes.`;
      rerun = true;
      break;
    case "failed":
      tone = "error";
      title = "Failed";
      body = room.reason;
      rerun = true;
      break;
    case "cancelled":
      title = "Cancelled";
      break;
    default:
      return null;
  }
  return (
    <div
      className={cn(
        "flex items-start gap-3 border px-3 py-2.5",
        tone === "error"
          ? "border-destructive/40 bg-destructive/5"
          : tone === "warning"
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-border bg-surface-1",
      )}
      data-testid="case-work-notice"
      role="status"
    >
      {room.status === "running" ? (
        <Loader
          aria-hidden
          className="mt-0.5 size-4 shrink-0 animate-spinner"
        />
      ) : (
        <TriangleAlertIcon
          aria-hidden
          className={cn(
            "mt-0.5 size-4 shrink-0",
            tone === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body text-foreground" style={semibold}>
          {title}
        </span>
        {body ? (
          <span className="text-body text-muted-foreground">{body}</span>
        ) : null}
      </div>
      {room.status === "running" || room.status === "waiting" ? (
        <LoadingButton
          className="w-auto shrink-0"
          onAction={actions.cancel}
          pendingLabel="Cancelling"
          size="compact"
          successLabel="Cancelled"
          variant="ghost"
        >
          Cancel case
        </LoadingButton>
      ) : null}
      {rerun ? (
        <LoadingButton
          className="w-auto shrink-0"
          onAction={actions.rerun}
          pendingLabel="Starting"
          size="compact"
          successLabel="Started"
          variant="secondary"
        >
          Rerun
        </LoadingButton>
      ) : null}
    </div>
  );
}

const conflictMessage =
  "Someone changed this field since you opened it. The latest value is shown.";

async function settle(result: Promise<WriteResult>, onConflict: () => void) {
  const written = await result;
  if (written.result === "conflict") {
    onConflict();
    throw new AsyncActionAbortError();
  }
  if (written.result === "refused") throw new Error(written.reason);
}

function FieldEditor({
  field,
  actions,
  onDone,
  onConflict,
}: Readonly<{
  field: RoomField;
  actions: CaseWorkActions;
  onDone: () => void;
  onConflict: () => void;
}>) {
  const initial = field.answer?.value;
  const [value, setValue] = useState<string>(
    typeof initial === "string" || typeof initial === "number"
      ? String(initial)
      : "",
  );
  const [error, setError] = useState<string | null>(null);
  const version = field.answer?.version ?? 0;

  const save = async () => {
    let next: unknown = value.trim();
    if (field.kind === "number") {
      const parsed = Number(next);
      if (next === "" || Number.isNaN(parsed)) {
        setError("Enter a number.");
        throw new AsyncActionAbortError();
      }
      next = parsed;
    }
    if (next === "") {
      setError("Enter a value, or leave the field as it is.");
      throw new AsyncActionAbortError();
    }
    setError(null);
    await settle(
      actions.edit({ path: field.path, value: next, version }),
      onConflict,
    );
    onDone();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {field.kind === "select" && field.options ? (
          <Select
            onValueChange={(next) => setValue(String(next))}
            value={value}
          >
            <SelectTrigger
              aria-label={fieldLabel(field.path)}
              className="min-w-0 flex-1"
            />
            <SelectContent>
              {field.options.map((option, index) => (
                <SelectItem index={index} key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            aria-invalid={error ? true : undefined}
            aria-label={fieldLabel(field.path)}
            autoFocus
            className="min-w-0 flex-1"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onDone();
            }}
            type={
              field.kind === "date"
                ? "date"
                : field.kind === "number"
                  ? "number"
                  : "text"
            }
            value={value}
          />
        )}
        <LoadingButton
          className="w-auto shrink-0"
          onAction={save}
          pendingLabel="Saving"
          size="compact"
          successLabel="Saved"
        >
          Save
        </LoadingButton>
        <Button onClick={onDone} size="compact" type="button" variant="ghost">
          Cancel
        </Button>
      </div>
      {error ? (
        <span className="text-body text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function Line({
  children,
  tone,
}: Readonly<{ children: ReactNode; tone?: "error" }>) {
  return (
    <span
      className={cn(
        "text-body",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function FieldRow({
  field,
  room,
  actions,
  failing,
}: Readonly<{
  field: RoomField;
  room: CaseRoomState;
  actions: CaseWorkActions;
  failing: readonly string[];
}>) {
  const [editing, setEditing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const answer = field.answer;
  const editable = isEditable(room.status);
  const version = answer?.version ?? 0;
  const needsConfirm =
    editable &&
    answer !== null &&
    (answer.status === "stale" ||
      (field.review === "required" && answer.status === "agent"));

  return (
    <li
      className="flex flex-col gap-1.5 border-b border-border px-4 py-3 last:border-b-0"
      data-field={field.path}
    >
      <div className="flex items-start gap-3">
        <div className="flex w-36 shrink-0 flex-col gap-1">
          <span className="text-body text-muted-foreground">
            {fieldLabel(field.path)}
          </span>
          {field.review === "required" ? (
            <Badge className="w-fit" size="sm">
              Review
            </Badge>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {editing ? (
            <FieldEditor
              actions={actions}
              field={field}
              onConflict={() => {
                setConflict(true);
                setEditing(false);
              }}
              onDone={() => setEditing(false)}
            />
          ) : (
            <span
              className={cn(
                "text-body",
                answer && answer.value !== null
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
              style={answer?.status === "stale" ? undefined : semibold}
            >
              {answer ? formatValue(field, answer.value) : "Not answered yet"}
            </span>
          )}
          {answer && !editing ? (
            <Line>
              {answer.status === "stale"
                ? `Stale: ${(answer.staleBecause ?? [])
                    .map(
                      (r) =>
                        `${fieldLabel(r.path)} changed from ${String(r.from)} to ${String(r.to)}`,
                    )
                    .join("; ")}`
                : answer.status === "confirmed"
                  ? `Confirmed · ${who(answer.setBy)}`
                  : "Agent"}
            </Line>
          ) : null}
          {answer && "suggestedValue" in answer && !editing ? (
            <div className="flex items-center gap-2">
              <Line>
                Agent suggests{" "}
                <span className="text-foreground">
                  {formatValue(field, answer.suggestedValue)}
                </span>
              </Line>
              {editable ? (
                <LoadingButton
                  className="w-auto shrink-0"
                  onAction={() =>
                    settle(actions.accept({ path: field.path, version }), () =>
                      setConflict(true),
                    )
                  }
                  pendingLabel="Accepting"
                  size="compact"
                  successLabel="Accepted"
                  variant="secondary"
                >
                  Accept
                </LoadingButton>
              ) : null}
            </div>
          ) : null}
          {field.error ? <Line tone="error">{field.error}</Line> : null}
          {failing.map((message) => (
            <Line key={message} tone="error">
              {message}
            </Line>
          ))}
          {conflict ? <Line tone="error">{conflictMessage}</Line> : null}
        </div>
        {editable && !editing ? (
          <div className="flex shrink-0 items-center gap-1">
            {needsConfirm ? (
              <LoadingButton
                className="w-auto shrink-0"
                onAction={() =>
                  settle(actions.confirm({ path: field.path, version }), () =>
                    setConflict(true),
                  )
                }
                pendingLabel="Confirming"
                size="compact"
                successLabel="Confirmed"
                variant="secondary"
              >
                Confirm
              </LoadingButton>
            ) : null}
            <Button
              onClick={() => {
                setConflict(false);
                setEditing(true);
              }}
              size="compact"
              type="button"
              variant="ghost"
            >
              Edit
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** The Review view: approvals, the case's answers, what to check, and Rerun. */
export function CaseRoomReview() {
  const work = useCaseWork();
  if (!work || !hasReview(work.room)) return null;
  const { room, actions } = work;
  const visible = room.fields.filter((f) => f.visible);
  const hidden = room.fields.filter((f) => !f.visible);
  const failing = room.checks.filter((c) => !c.ok);
  const unattached = failing.filter((c) => !c.field);
  const canRerun =
    isEditable(room.status) &&
    room.status !== "halted" &&
    room.status !== "failed";

  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 py-5">
        <CaseWorkNotice actions={actions} room={room} />
        {unattached.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {unattached.map((check) => (
              <li key={check.name}>
                <Line tone="error">{check.message ?? check.name}</Line>
              </li>
            ))}
          </ul>
        ) : null}
        <CaseRoomApprovals actions={actions} room={room} />
        <CaseRoomMemories actions={actions} memories={room.memories} />
        {visible.length > 0 ? (
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-body text-foreground" style={semibold}>
                Answers
              </h2>
              {failing.length === 0 && room.checks.length > 0 ? (
                <span className="flex items-center gap-1 text-body text-muted-foreground">
                  <CircleCheckIcon aria-hidden className="size-3.5" />
                  All checks pass
                </span>
              ) : null}
            </div>
            <ul className="border border-border bg-surface-1">
              {visible.map((field) => (
                <FieldRow
                  actions={actions}
                  failing={failing
                    .filter((c) => c.field === field.path)
                    .map((c) => c.message ?? c.name)}
                  field={field}
                  key={field.path}
                  room={room}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {hidden.length > 0 ? (
          <section className="flex flex-col gap-1">
            <h2 className="text-body text-muted-foreground">
              {hidden.length === 1
                ? "1 hidden field"
                : `${hidden.length} hidden fields`}
            </h2>
            {hidden.map((field) => (
              <Line key={field.path}>
                {fieldLabel(field.path)}, hidden because{" "}
                {(field.hiddenBecause ?? [])
                  .map((h) => `${fieldLabel(h.path)} is ${String(h.value)}`)
                  .join(" and ")}
              </Line>
            ))}
          </section>
        ) : null}
        {canRerun ? (
          <div className="flex items-center justify-end gap-2">
            <span className="text-body text-muted-foreground">
              Rerun sends the agent what changed since its last run.
            </span>
            <LoadingButton
              className="w-auto shrink-0"
              onAction={actions.rerun}
              pendingLabel="Starting"
              size="compact"
              successLabel="Started"
            >
              Rerun
            </LoadingButton>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
