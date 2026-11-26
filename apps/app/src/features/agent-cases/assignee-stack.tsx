import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  avatarMarbleSeed,
} from "@preprocess/ui/components/avatar";
import { Badge } from "@preprocess/ui/components/badge";
import { Tooltip } from "@preprocess/ui/components/tooltip";
import { TriangleAlertIcon, User } from "@preprocess/ui/lib/icons";
import { cn } from "@preprocess/ui/lib/utils";

import { needsAssignmentPhrase, type Case, type CaseAssignee } from "./case";

const assigneeList = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
});

/** "Ada Park", "Ada Park and Theo Grant", "No assignee". */
export function assigneesLabel(assignees: readonly CaseAssignee[]) {
  return assignees.length > 0
    ? assigneeList.format(assignees.map((assignee) => assignee.name))
    : "No assignee";
}

/**
 * A case's assignees as overlapping avatars: up to `max`, then "+N". The
 * tooltip names everyone. Nobody assigned shows a muted person glyph.
 */
export function AssigneeStack({
  assignees,
  max = 3,
  className,
}: Readonly<{
  assignees: readonly CaseAssignee[];
  max?: number;
  className?: string;
}>) {
  const label = assigneesLabel(assignees);
  if (assignees.length === 0) {
    return (
      <Tooltip content={label} side="top">
        <span
          aria-label={label}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full bg-hover text-muted-foreground",
            className,
          )}
        >
          <User aria-hidden="true" className="size-3.5" />
        </span>
      </Tooltip>
    );
  }
  // At the limit everyone fits; past it, the last slot becomes "+N".
  const shown =
    assignees.length > max ? assignees.slice(0, max - 1) : assignees;
  const hidden = assignees.length - shown.length;
  return (
    <Tooltip content={label} side="top">
      <AvatarGroup aria-label={label} className={cn("shrink-0", className)}>
        {shown.map((assignee) => (
          <Avatar key={assignee.id} size="sm">
            <AvatarFallback name={avatarMarbleSeed(assignee)} />
          </Avatar>
        ))}
        {hidden > 0 ? (
          <AvatarGroupCount className="text-micro tabular-nums">
            +{hidden}
          </AvatarGroupCount>
        ) : null}
      </AvatarGroup>
    </Tooltip>
  );
}

/**
 * Marks a case waiting on a group with no one from it assigned. Hovering
 * names the uncovered groups.
 */
export function NeedsAssignmentTag({
  item,
  className,
}: Readonly<{
  item: Pick<Case, "awaiting" | "assignees">;
  className?: string;
}>) {
  const phrase = needsAssignmentPhrase(item);
  if (!phrase) return null;
  return (
    <Tooltip content={phrase} side="top">
      <Badge
        aria-label={`Needs assignment: ${phrase}`}
        className={cn("shrink-0", className)}
        color="amber"
        size="sm"
      >
        <span className="flex items-center gap-1">
          <TriangleAlertIcon aria-hidden="true" className="size-3" />
          Needs assignment
        </span>
      </Badge>
    </Tooltip>
  );
}
