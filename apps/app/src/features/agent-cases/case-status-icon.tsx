import { badgeColors, type BadgeColor } from "@preprocess/ui/components/badge";
import { CircleCheckIcon, Clock, Loader } from "@preprocess/ui/lib/icons";
import type {
  IconComponent,
  IconComponentProps,
} from "@preprocess/ui/lib/icon-context";
import { cn } from "@preprocess/ui/lib/utils";

import type { CaseStatus } from "./case";

const STATUS_GLYPH: Record<
  CaseStatus,
  { icon: IconComponent; color: BadgeColor }
> = {
  Waiting: { icon: Clock, color: "yellow" },
  Active: { icon: Loader, color: "blue" },
  Done: { icon: CircleCheckIcon, color: "green" },
};

export function caseStatusColor(status: CaseStatus): BadgeColor {
  return STATUS_GLYPH[status].color;
}

/** The status glyph that leads case rows and group headers. */
export function CaseStatusIcon({
  status,
  className,
}: Readonly<{ status: CaseStatus; className?: string }>) {
  const { icon: Icon, color } = STATUS_GLYPH[status];
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0", className)}
      style={{ color: badgeColors[color] }}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

function statusMenuIcon(status: CaseStatus): IconComponent {
  const { icon: Icon, color } = STATUS_GLYPH[status];
  // The menu row places its icon with grid classes and tints it muted or
  // foreground. The span takes the placement (centered in the cell, which
  // its sizer copy makes a line tall); its inline color outranks the tint
  // class, and the glyph draws in currentColor.
  function StatusMenuIcon({ className, ...props }: IconComponentProps) {
    return (
      <span
        className={cn(className, "inline-flex self-center")}
        style={{ color: badgeColors[color] }}
      >
        <Icon {...props} className="text-current" />
      </span>
    );
  }
  return StatusMenuIcon;
}

/** The status glyphs as menu icons, in their status colors. */
export const CASE_STATUS_MENU_ICON: Record<CaseStatus, IconComponent> = {
  Waiting: statusMenuIcon("Waiting"),
  Active: statusMenuIcon("Active"),
  Done: statusMenuIcon("Done"),
};
